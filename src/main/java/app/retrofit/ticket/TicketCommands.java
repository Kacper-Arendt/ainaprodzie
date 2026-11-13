package app.retrofit.ticket;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.function.UnaryOperator;

import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import app.retrofit.organization.Caller;
import app.retrofit.organization.CallerLookup;
import app.retrofit.platform.FieldError;
import app.retrofit.platform.Validations;
import app.retrofit.ticket.JdbcTicketRepository.StoredLink;
import app.retrofit.ticket.TicketChanges.Field;

/// The write side of tickets. Every command reads its caller once, refuses before writing anything, and answers with
/// the ticket as [TicketQueries] renders it. Transactions stay at READ COMMITTED: a duplicate waiting on an
/// `Idempotency-Key` claim must see the owner's committed row, not fail serialization.
@Service
class TicketCommands {

	private static final int TITLE_MAX = 200;

	private static final int DESCRIPTION_MAX = 10_000;

	private static final int BODY_MAX = 10_000;

	private static final int RESOLUTION_MAX = 2_000;

	// The TicketCategory vocabulary, which the ticket_category_check constraint also spells.
	private static final List<String> CATEGORIES = Arrays.stream(TicketCategory.values()).map(Enum::name).toList();

	// The LinkType vocabulary, which the ticket_link_type_check constraint also spells.
	private static final List<String> LINK_TYPES = Arrays.stream(LinkType.values()).map(Enum::name).toList();

	private static final List<String> PRIORITIES = Arrays.stream(TicketPriority.values()).map(Enum::name).toList();

	// CLOSED is reached only through close, which also records the closing time.
	private static final List<String> EDITABLE_STATUSES = Arrays.stream(TicketStatus.values())
			.filter(status -> status != TicketStatus.CLOSED)
			.map(Enum::name)
			.toList();

	private final JdbcTicketRepository tickets;

	private final CallerLookup callers;

	private final TicketQueries queries;

	private final IdempotencyKeys idempotencyKeys;

	private final Clock clock;

	TicketCommands(JdbcTicketRepository tickets, CallerLookup callers, TicketQueries queries,
			IdempotencyKeys idempotencyKeys, Clock clock) {
		this.tickets = tickets;
		this.callers = callers;
		this.queries = queries;
		this.idempotencyKeys = idempotencyKeys;
		this.clock = clock;
	}

	/// Opens a ticket in the customer's organization: NEW, NORMAL, untriaged, version 0, with one CREATED entry.
	@Transactional
	TicketDetails create(UUID callerId, @Nullable String title, @Nullable String description, @Nullable String category,
			@Nullable String idempotencyKey) {
		if (!(callers.current(callerId) instanceof Caller.Customer customer)) {
			throw TicketProblems.forbidden();
		}
		var errors = new ArrayList<FieldError>();
		var trimmedTitle = validTitle(errors, title == null ? "" : title);
		var storedDescription = validDescription(errors, description == null ? "" : description);
		var storedCategory = category == null ? null
				: Validations.requireAllowed(errors, "category", category, CATEGORIES);
		IdempotencyKeys.validate(errors, idempotencyKey);
		Validations.throwIfInvalid(errors);

		var now = clock.instant();
		if (idempotencyKey != null) {
			var hash = idempotencyKeys.requestHash("create-ticket", null, trimmedTitle, storedDescription,
					storedCategory);
			var replay = idempotencyKeys.claim(callerId, idempotencyKey, hash, now);
			if (replay.isPresent()) {
				return render(customer, replay.get().reference());
			}
		}
		var id = UUID.randomUUID();
		var number = tickets.insert(id, customer, trimmedTitle, storedDescription, storedCategory, now);
		tickets.audit(id, customer.id(), now, List.of(new Ticket.Change(AuditedField.CREATED, null, trimmedTitle)));
		if (idempotencyKey != null) {
			idempotencyKeys.fill(callerId, idempotencyKey, id, null, HttpStatus.CREATED.value());
		}
		return render(customer, new TicketReference(number).toString());
	}

	/// Adds a public comment or, for support, an internal note, which may move the ticket on, see
	/// [Ticket#commented]. The ticket row stays locked from the first read to the commit, so comments on one ticket
	/// serialize: each reads `now` after the lock, and the earliest support reply is the one `first_response_at`
	/// keeps. The lock comes before the key claim, and create never locks a ticket, so the two cannot deadlock.
	@Transactional
	TicketDetails addComment(UUID callerId, String reference, @Nullable String body, @Nullable Boolean internal,
			@Nullable String idempotencyKey) {
		var caller = callers.current(callerId);
		var ticket = queries.findState(caller, reference, true).orElseThrow(() -> TicketProblems.notFound(reference));
		var now = clock.instant();
		var note = Boolean.TRUE.equals(internal);
		var fromSupport = caller instanceof Caller.Support;
		if (note && !fromSupport) {
			throw TicketProblems.forbidden();
		}
		var errors = new ArrayList<FieldError>();
		var storedBody = body == null ? "" : body;
		if (storedBody.isBlank()) {
			errors.add(new FieldError("body", "field.required", "Must not be blank."));
		}
		requireAtMost(errors, "body", storedBody, BODY_MAX);
		requireNoNul(errors, "body", storedBody);
		IdempotencyKeys.validate(errors, idempotencyKey);
		Validations.throwIfInvalid(errors);

		if (idempotencyKey != null) {
			var hash = idempotencyKeys.requestHash("add-comment", ticket.reference(), storedBody, note);
			var replay = idempotencyKeys.claim(callerId, idempotencyKey, hash, now);
			if (replay.isPresent()) {
				return render(caller, replay.get().reference());
			}
		}
		if (!fromSupport && ticket.status() == TicketStatus.CLOSED) {
			throw TicketProblems.closed(ticket.reference());
		}
		var commented = ticket.commented(fromSupport, note, now);
		// The row is locked, so its version cannot have moved since the read.
		if (!tickets.update(ticket, commented, now)) {
			throw new IllegalStateException("Ticket " + ticket.reference() + " moved past its locked version");
		}
		var commentId = UUID.randomUUID();
		tickets.insertComment(commentId, ticket.id(), caller.id(), note, storedBody, now);
		tickets.audit(ticket.id(), caller.id(), now, ticket.changesTo(commented));
		if (idempotencyKey != null) {
			idempotencyKeys.fill(callerId, idempotencyKey, ticket.id(), commentId, HttpStatus.CREATED.value());
		}
		return render(caller, ticket.reference());
	}

	/// Closes a ticket for its author from any status (withdrawing or confirming it) and for support staff once it is
	/// resolved. A close of a closed ticket that sends no other resolution changes nothing and answers the ticket as it
	/// is, whatever `If-Match`, so a retry after a lost response is no conflict (ADR 0003). There is no lock: of two
	/// closes based on one version only the first writes, see [#commit]. A blank resolution counts as absent and keeps
	/// the stored one.
	@Transactional
	TicketDetails close(UUID callerId, String reference, @Nullable String resolution, @Nullable String ifMatch) {
		var caller = callers.current(callerId);
		var ticket = queries.findState(caller, reference, false).orElseThrow(() -> TicketProblems.notFound(reference));
		var closesOnlyResolved = !isAuthor(caller, ticket);
		var now = clock.instant();
		var errors = new ArrayList<FieldError>();
		var sentResolution = resolution == null || resolution.isBlank() ? null : resolution;
		if (sentResolution != null) {
			requireAtMost(errors, "resolution", sentResolution, RESOLUTION_MAX);
			requireNoNul(errors, "resolution", sentResolution);
		}
		Validations.throwIfInvalid(errors);

		UnaryOperator<Ticket> close = current -> current.closed(sentResolution, now);
		if (holds(ticket, close)) {
			return render(caller, ticket.reference());
		}
		requireCurrent(ifMatch, ticket);
		if (ticket.status() == TicketStatus.CLOSED) {
			throw TicketProblems.alreadyClosed(ticket.reference());
		}
		if (closesOnlyResolved && ticket.status() != TicketStatus.RESOLVED) {
			throw TicketProblems.notResolved(ticket.reference());
		}
		return commit(caller, ticket, close, now);
	}

	/// Applies a support edit as a merge patch. The body is validated in full before `If-Match` is looked at. An edit
	/// that changes nothing answers the ticket as it is, version and `updated_at` untouched, whatever `If-Match` and
	/// even on a closed ticket, so a retry after a lost response is no conflict (ADR 0003). An edit that changes
	/// something then needs a current `If-Match` and an open ticket, and only then meets the lifecycle rules, which
	/// depend on the ticket's status (see [#requireLifecycle]).
	@Transactional
	TicketDetails update(UUID callerId, String reference, TicketChanges changes, @Nullable String ifMatch) {
		var caller = callers.current(callerId);
		var ticket = queries.findState(caller, reference, false).orElseThrow(() -> TicketProblems.notFound(reference));
		if (!(caller instanceof Caller.Support)) {
			throw TicketProblems.forbidden();
		}
		var errors = new ArrayList<FieldError>();
		var status = changes.status() instanceof Field.Present<String>(var value)
				&& TicketStatus.CLOSED.name().equals(value)
						? refuseClosedStatus(errors, ticket.status())
						: requiredChoice(errors, "status", changes.status(), ticket.status(), TicketStatus.class,
								EDITABLE_STATUSES);
		var sentResolution = sentResolution(errors, changes.resolution());
		var priority = requiredChoice(errors, "priority", changes.priority(), ticket.priority(), TicketPriority.class,
				PRIORITIES);
		var category = switch (changes.category()) {
			case Field.Absent<String> _ -> ticket.category();
			case Field.Cleared<String> _ -> null;
			case Field.Present<String>(var value) -> {
				var known = Validations.requireAllowed(errors, "category", value, CATEGORIES);
				yield known == null ? ticket.category() : TicketCategory.valueOf(known);
			}
		};
		var team = switch (changes.teamId()) {
			case Field.Absent<UUID> _ -> ticket.team();
			case Field.Cleared<UUID> _ -> null;
			case Field.Present<UUID>(var id) -> tickets.findTeam(id).orElseGet(() -> {
				errors.add(new FieldError("teamId", "teamId.unknown", "No such team."));
				return ticket.team();
			});
		};
		var teamChanged = !Objects.equals(Ticket.idOf(team), Ticket.idOf(ticket.team()));
		// The stored assignee is a member of the stored team (ticket_assignee_fk), so a new team never keeps them.
		var assignee = switch (changes.assigneeId()) {
			case Field.Absent<UUID> _ -> teamChanged ? null : ticket.assignee();
			case Field.Cleared<UUID> _ -> null;
			case Field.Present<UUID>(var id) when !teamChanged && id.equals(Ticket.idOf(ticket.assignee())) ->
				ticket.assignee();
			case Field.Present<UUID>(var id) -> assignable(errors, id, team);
		};
		Validations.throwIfInvalid(errors);

		var resolution = sentResolution != null ? sentResolution : ticket.resolution();
		UnaryOperator<Ticket> edit = current -> current.withFacts(status, resolution, priority, category, team,
				assignee);
		if (holds(ticket, edit)) {
			return render(caller, ticket.reference());
		}
		requireCurrent(ifMatch, ticket);
		if (ticket.status() == TicketStatus.CLOSED) {
			throw TicketProblems.closed(ticket.reference());
		}
		requireLifecycle(ticket, status, changes.resolution(), sentResolution);
		return commit(caller, ticket, edit, clock.instant());
	}

	/// Replaces a ticket's title or description, for its author while it is NEW and for support staff until it is
	/// closed (ADR 0004); an absent field keeps what is stored. The checks run in [#update]'s order: the caller, the
	/// fields, then an edit that changes nothing answers the ticket as it is whatever `If-Match` and the status, and
	/// only an edit that changes something needs a current `If-Match`, an open ticket and, for the author, a NEW one.
	@Transactional
	TicketDetails edit(UUID callerId, String reference, Field<String> title, Field<String> description,
			@Nullable String ifMatch) {
		var caller = callers.current(callerId);
		var ticket = queries.findState(caller, reference, false).orElseThrow(() -> TicketProblems.notFound(reference));
		var editsOnlyNew = isAuthor(caller, ticket);
		var errors = new ArrayList<FieldError>();
		var newTitle = switch (title) {
			case Field.Absent<String> _ -> ticket.title();
			case Field.Cleared<String> _ -> refuseNull(errors, "title", ticket.title());
			case Field.Present<String>(var value) -> validTitle(errors, value);
		};
		var newDescription = switch (description) {
			case Field.Absent<String> _ -> ticket.description();
			case Field.Cleared<String> _ -> refuseNull(errors, "description", ticket.description());
			case Field.Present<String>(var value) -> validDescription(errors, value);
		};
		Validations.throwIfInvalid(errors);

		UnaryOperator<Ticket> edit = current -> current.withContent(newTitle, newDescription);
		if (holds(ticket, edit)) {
			return render(caller, ticket.reference());
		}
		requireCurrent(ifMatch, ticket);
		if (ticket.status() == TicketStatus.CLOSED) {
			throw TicketProblems.closed(ticket.reference());
		}
		if (editsOnlyNew && ticket.status() != TicketStatus.NEW) {
			throw TicketProblems.notEditable(ticket.reference());
		}
		return commit(caller, ticket, edit, clock.instant());
	}

	/// Links two tickets as `type`, from either end, or switches the type of their link. Every write stores the pair
	/// from the later ticket to the earlier one, so a switch is one UPDATE that also rewrites the direction. The same
	/// type again answers the ticket as it is. Closed tickets are linked like open ones.
	@Transactional
	TicketDetails link(UUID callerId, String reference, String linkedReference, @Nullable String type) {
		var errors = new ArrayList<FieldError>();
		var known = Validations.requireAllowed(errors, "type", type, LINK_TYPES);
		var pair = lockPair(callerId, reference, linkedReference, errors);
		var requested = LinkType.valueOf(Objects.requireNonNull(known));
		var stored = pair.stored();
		if (stored != null && stored.type() == requested) {
			return render(pair.caller(), pair.addressed().reference());
		}
		var later = pair.later();
		var earlier = later == pair.addressed() ? pair.other() : pair.addressed();
		if (stored == null) {
			var inserted = tickets.insertLink(later.id(), earlier.id(), requested, pair.caller().id(), pair.now());
			// A safety net: every link writer holds both row locks, so no other insert can land in between.
			if (!inserted) {
				return render(pair.caller(), pair.addressed().reference());
			}
		}
		else {
			tickets.updateLink(stored.id(), requested, later.id(), earlier.id());
		}
		recordLinkChange(pair, requested);
		return render(pair.caller(), pair.addressed().reference());
	}

	/// Removes the link between two tickets, from either end. When there is none, answers the ticket as it is.
	@Transactional
	TicketDetails unlink(UUID callerId, String reference, String linkedReference) {
		var pair = lockPair(callerId, reference, linkedReference, new ArrayList<>());
		var stored = pair.stored();
		if (stored == null) {
			return render(pair.caller(), pair.addressed().reference());
		}
		tickets.deleteLink(stored.id());
		recordLinkChange(pair, null);
		return render(pair.caller(), pair.addressed().reference());
	}

	/// Whether `ticket` already holds what `change` asks for, so the command has nothing to write (ADR 0003).
	private static boolean holds(Ticket ticket, UnaryOperator<Ticket> change) {
		return ticket.changesTo(change.apply(ticket)).isEmpty();
	}

	/// Writes `change` over `ticket` unless its version has moved on since the read, then records one history entry
	/// per changed field. When the version has moved on, a ticket that now holds what the change asks for is answered
	/// as it is: the same change from the same read committed first. Any other ticket is a conflict.
	private TicketDetails commit(Caller caller, Ticket ticket, UnaryOperator<Ticket> change, Instant now) {
		var changed = change.apply(ticket);
		if (!tickets.update(ticket, changed, now)) {
			var current = queries.findState(caller, ticket.reference(), false)
					.orElseThrow(() -> TicketProblems.notFound(ticket.reference()));
			if (holds(current, change)) {
				return render(caller, ticket.reference());
			}
			throw TicketProblems.modified(current.version());
		}
		tickets.audit(ticket.id(), caller.id(), now, ticket.changesTo(changed));
		return render(caller, ticket.reference());
	}

	/// The checks every link command makes before writing: the addressed ticket is visible, the caller is support
	/// staff, the other ticket is visible and is another ticket. `errors` holds the command's own field errors, so one
	/// 422 carries them all. Then locks the pair and reads its link.
	private LinkPair lockPair(UUID callerId, String reference, String linkedReference, List<FieldError> errors) {
		var caller = callers.current(callerId);
		var addressed = queries.findState(caller, reference, false).orElseThrow(() -> TicketProblems.notFound(reference));
		if (!(caller instanceof Caller.Support)) {
			throw TicketProblems.forbidden();
		}
		var other = queries.findState(caller, linkedReference, false)
				.orElseThrow(() -> TicketProblems.notFound(linkedReference));
		requireAnotherTicket(errors, addressed, other);
		Validations.throwIfInvalid(errors);

		tickets.lockPair(addressed.id(), other.id());
		var stored = tickets.findLink(addressed.id(), other.id()).orElse(null);
		var later = addressed.number() > other.number() ? addressed : other;
		return new LinkPair(caller, addressed, other, later, stored, clock.instant());
	}

	/// Compared by id, so `ret-5` and `RET-5` are the same ticket.
	private static void requireAnotherTicket(List<FieldError> errors, Ticket addressed, Ticket other) {
		if (addressed.id().equals(other.id())) {
			errors.add(new FieldError("linkedReference", "linkedReference.self",
					"A ticket cannot be linked to itself."));
		}
	}

	/// Raises both tickets' version and updated time and writes one LINK entry on each, the addressed ticket first.
	/// The old value is read from the stored row; the new one from the later-to-earlier rule.
	private void recordLinkChange(LinkPair pair, @Nullable LinkType after) {
		var addressed = pair.addressed();
		var other = pair.other();
		tickets.touchPair(addressed.id(), other.id(), pair.now());
		var before = pair.stored();
		for (var ticket : List.of(addressed, other)) {
			var otherTicket = ticket == addressed ? other : addressed;
			tickets.audit(ticket.id(), pair.caller().id(), pair.now(), List.of(new Ticket.Change(AuditedField.LINK,
					before == null ? null : sideValue(before.type(), before.ticketId(), ticket, otherTicket),
					after == null ? null : sideValue(after, pair.later().id(), ticket, otherTicket))));
		}
	}

	/// A link as `ticket` reads it, as [TicketQueries] names the relation: `RELATED RET-1003`,
	/// `POTENTIAL_DUPLICATE_OF RET-1001` on the ticket it is stored from, `HAS_POTENTIAL_DUPLICATE RET-1022` on the
	/// other one.
	private static String sideValue(LinkType type, UUID storedFrom, Ticket ticket, Ticket otherTicket) {
		var relation = switch (type) {
			case RELATED -> LinkRelation.RELATED;
			case POTENTIAL_DUPLICATE -> storedFrom.equals(ticket.id()) ? LinkRelation.POTENTIAL_DUPLICATE_OF
					: LinkRelation.HAS_POTENTIAL_DUPLICATE;
		};
		return relation.name() + " " + otherTicket.reference();
	}

	/// Whether the caller acts as the ticket's author rather than as support staff; any other customer is forbidden.
	private static boolean isAuthor(Caller caller, Ticket ticket) {
		return switch (caller) {
			case Caller.Customer customer when !customer.id().equals(ticket.authorId()) -> throw TicketProblems.forbidden();
			case Caller.Customer _ -> true;
			case Caller.Support _ -> false;
		};
	}

	/// The resolution an edit sends, checked on its own: a blank one counts as absent, `null` is `field.required`.
	private static @Nullable String sentResolution(List<FieldError> errors, Field<String> change) {
		var sent = switch (change) {
			case Field.Absent<String> _ -> null;
			case Field.Cleared<String> _ -> {
				errors.add(new FieldError("resolution", "field.required", "Must not be null."));
				yield null;
			}
			case Field.Present<String>(var value) -> value.isBlank() ? null : value;
		};
		if (sent != null) {
			requireAtMost(errors, "resolution", sent, RESOLUTION_MAX);
			requireNoNul(errors, "resolution", sent);
		}
		return sent;
	}

	/// The rules that depend on the ticket's current status, checked only once `If-Match` has shown the caller read
	/// that status, so a stale edit answers 412 rather than a 422 about a status the caller never saw. The status
	/// moves only as [TicketStatus#canMoveTo] allows, a sent resolution needs a resulting status of RESOLVED, and
	/// moving to RESOLVED needs one sent or stored.
	private static void requireLifecycle(Ticket ticket, TicketStatus status, Field<String> change,
			@Nullable String sentResolution) {
		var errors = new ArrayList<FieldError>();
		if (status != ticket.status() && !ticket.status().canMoveTo(status)) {
			errors.add(new FieldError("status", "status.not-allowed",
					"Cannot move from " + ticket.status() + " to " + status + "."));
		}
		if (sentResolution != null && status != TicketStatus.RESOLVED) {
			errors.add(new FieldError("resolution", "resolution.not-resolved",
					"Only a resolved ticket takes a resolution."));
		}
		if (sentResolution == null && status == TicketStatus.RESOLVED && ticket.status() != TicketStatus.RESOLVED
				&& ticket.resolution() == null && !(change instanceof Field.Cleared<String>)) {
			errors.add(new FieldError("resolution", "field.required", "Resolving needs a resolution."));
		}
		Validations.throwIfInvalid(errors);
	}

	/// The title as stored, trimmed: one rule for raising and editing a ticket.
	private static String validTitle(List<FieldError> errors, String title) {
		var trimmed = title.strip();
		if (trimmed.isEmpty()) {
			errors.add(new FieldError("title", "field.required", "Must not be blank."));
		}
		requireAtMost(errors, "title", trimmed, TITLE_MAX);
		requireNoNul(errors, "title", trimmed);
		return trimmed;
	}

	/// The description as stored, as sent and possibly empty: one rule for raising and editing a ticket.
	private static String validDescription(List<FieldError> errors, String description) {
		requireAtMost(errors, "description", description, DESCRIPTION_MAX);
		requireNoNul(errors, "description", description);
		return description;
	}

	/// `null` for a field that cannot be cleared, which an edit leaves out instead to keep it.
	private static String refuseNull(List<FieldError> errors, String field, String stored) {
		errors.add(new FieldError(field, "field.required", "Must not be null."));
		return stored;
	}

	private static TicketStatus refuseClosedStatus(List<FieldError> errors, TicketStatus stored) {
		errors.add(new FieldError("status", "status.closed", "Close the ticket to set it to CLOSED."));
		return stored;
	}

	/// A field that cannot be cleared: absent keeps `stored`, `null` is `field.required`, a value must be allowed.
	private static <E extends Enum<E>> E requiredChoice(List<FieldError> errors, String field, Field<String> change,
			E stored, Class<E> type, List<String> allowed) {
		return switch (change) {
			case Field.Absent<String> _ -> stored;
			case Field.Cleared<String> _ -> {
				errors.add(new FieldError(field, "field.required", "Must not be null."));
				yield stored;
			}
			case Field.Present<String>(var value) -> {
				var known = Validations.requireAllowed(errors, field, value, allowed);
				yield known == null ? stored : Enum.valueOf(type, known);
			}
		};
	}

	/// The newly chosen assignee: a support account (`assigneeId.unknown` otherwise) that is enabled and a member of
	/// the resulting team (`assigneeId.not-in-team` otherwise).
	private @Nullable NamedRef assignable(List<FieldError> errors, UUID assigneeId, @Nullable NamedRef team) {
		var account = tickets.findSupportAccount(assigneeId);
		if (account.isEmpty()) {
			errors.add(new FieldError("assigneeId", "assigneeId.unknown", "No such support account."));
			return null;
		}
		if (!account.get().enabled() || team == null || !team.id().equals(account.get().teamId())) {
			errors.add(new FieldError("assigneeId", "assigneeId.not-in-team",
					"Must be an enabled member of the ticket's team."));
			return null;
		}
		return account.get().ref();
	}

	/// The `If-Match` step shared by the conditional writes: 428 without one, 412 unless it names the current version.
	private static void requireCurrent(@Nullable String ifMatch, Ticket ticket) {
		if (ifMatch == null) {
			throw TicketProblems.preconditionRequired();
		}
		if (!EntityTags.matches(ifMatch, ticket.version())) {
			throw TicketProblems.modified(ticket.version());
		}
	}

	private TicketDetails render(Caller caller, String reference) {
		return queries.find(caller, reference).orElseThrow(() -> TicketProblems.notFound(reference));
	}

	/// Counts characters, not UTF-16 units, so a limit means the same for every script.
	private static void requireAtMost(List<FieldError> errors, String field, String value, int max) {
		if (value.codePointCount(0, value.length()) > max) {
			errors.add(new FieldError(field, "field.too-long", "Must be at most " + max + " characters."));
		}
	}

	/// Postgres text cannot hold U+0000, so it is refused here rather than failing the write.
	private static void requireNoNul(List<FieldError> errors, String field, String value) {
		if (value.indexOf('\u0000') >= 0) {
			errors.add(new FieldError(field, "field.invalid", "Must not contain the NUL character."));
		}
	}

	/// Two tickets a link command addresses, locked, with the link stored between them and the ticket that is later.
	private record LinkPair(Caller caller, Ticket addressed, Ticket other, Ticket later, @Nullable StoredLink stored,
			Instant now) {
	}

}
