package app.retrofit.ticket;

import static app.retrofit.organization.CallerLookup.callerId;
import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import java.net.URI;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import app.retrofit.platform.FieldError;
import app.retrofit.platform.Validations;
import app.retrofit.ticket.TicketChanges.Field;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;

@RestController
@RequestMapping("/api/tickets")
@Tag(name = "tickets", description = "Tickets the signed-in user may see: a customer those of their organization "
		+ "without internal notes, support staff all of them.")
class TicketController {

	// Open Strings rather than enums: the command owns the vocabulary and limits and answers 422, not a 400.
	record CreateTicketRequest(@Schema(requiredMode = REQUIRED, description = "1 to 200 characters after trimming")
			@Nullable String title,
			@Schema(description = "At most 10,000 characters, stored as sent; empty when absent")
			@Nullable String description,
			@Schema(description = "BUG, QUESTION or FEATURE_REQUEST") @Nullable String category) {
	}

	record AddCommentRequest(@Schema(requiredMode = REQUIRED, description = "1 to 10,000 characters, not blank, "
			+ "stored as sent") @Nullable String body,
			@Schema(description = "An internal note, visible to support staff only; false when absent")
			@Nullable Boolean internal) {
	}

	record CloseTicketRequest(@Schema(description = "At most 2,000 characters; replaces the stored resolution, while a "
			+ "blank or absent one keeps it") @Nullable String resolution) {
	}

	/// Documents the PATCH body only: the body is read as a JSON object, so an absent field and `null` differ.
	record UpdateTicketRequest(
			@Schema(description = "1 to 200 characters after trimming; sent alone or with description, never with "
					+ "the other fields; null is refused") @Nullable String title,
			@Schema(description = "At most 10,000 characters, stored as sent and may be empty; sent alone or with "
					+ "title, never with the other fields; null is refused") @Nullable String description,
			@Schema(description = "IN_PROGRESS, WAITING_FOR_CUSTOMER or RESOLVED from an open status other than "
					+ "itself, IN_PROGRESS from RESOLVED; nothing returns to NEW and CLOSED only through close")
			@Nullable String status,
			@Schema(description = "LOW, NORMAL, HIGH or CRITICAL") @Nullable String priority,
			@Schema(nullable = true, description = "BUG, QUESTION or FEATURE_REQUEST; null clears it")
			@Nullable String category,
			@Schema(nullable = true, description = "null clears the team and the assignee; a new team without an "
					+ "assigneeId clears the assignee") @Nullable UUID teamId,
			@Schema(nullable = true, description = "An enabled support member of the resulting team; null unassigns")
			@Nullable UUID assigneeId,
			@Schema(description = "At most 2,000 characters; sent only with a resulting status of RESOLVED, and "
					+ "required for moving to RESOLVED unless the ticket already has one, which it replaces; null is "
					+ "refused and a blank one counts as absent") @Nullable String resolution) {
	}

	record LinkTicketRequest(@Schema(requiredMode = REQUIRED, description = "RELATED or POTENTIAL_DUPLICATE; a "
			+ "potential duplicate is stored from the later ticket to the earlier one, whichever ticket the request "
			+ "addresses") @Nullable String type) {
	}

	private final TicketQueries queries;

	private final TicketCommands commands;

	TicketController(TicketQueries queries, TicketCommands commands) {
		this.queries = queries;
		this.commands = commands;
	}

	@Operation(summary = "One page of the tickets the signed-in user may see; every filter given applies")
	@ApiResponse(responseCode = "200", description = "The page and the number of matching tickets")
	@ApiResponse(responseCode = "400", description = "Problem type slug: malformed-request (a parameter of the wrong "
			+ "type or outside its vocabulary)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "401", description = "Problem type slug: auth/unauthenticated",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "422", description = "Problem type slug: validation (errors[].code page.invalid, "
			+ "size.invalid, createdFrom.invalid, createdTo.invalid or deadlineBefore.invalid: an instant outside "
			+ "the years 1 to 9999, or createdFrom after createdTo)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@GetMapping
	TicketPage list(Authentication authentication,
			@Parameter(description = "A reference such as RET-1042, or text to find in the title or description, "
					+ "from the start of a word")
			@RequestParam(required = false) @Nullable String text,
			@RequestParam(required = false) @Nullable UUID organizationId,
			@RequestParam(name = "status", required = false) @Nullable Set<@Nullable TicketStatus> statuses,
			@RequestParam(name = "category", required = false) @Nullable Set<@Nullable TicketCategory> categories,
			@RequestParam(name = "priority", required = false) @Nullable Set<@Nullable TicketPriority> priorities,
			@RequestParam(required = false) @Nullable UUID teamId,
			@RequestParam(required = false) @Nullable UUID assigneeId,
			@RequestParam(required = false) @Nullable Boolean slaBreached,
			@Parameter(description = "Tickets raised by this customer")
			@RequestParam(required = false) @Nullable UUID authorId,
			@Parameter(description = "Tickets created at or after this instant (ISO-8601)")
			@RequestParam(required = false) @Nullable Instant createdFrom,
			@Parameter(description = "Tickets created before this instant (ISO-8601); not before createdFrom")
			@RequestParam(required = false) @Nullable Instant createdTo,
			@Parameter(description = "Tickets still awaiting a first response, not closed, whose response deadline "
					+ "falls before this instant (ISO-8601), the breached ones included")
			@RequestParam(required = false) @Nullable Instant deadlineBefore,
			@Parameter(description = "The tickets one of the desk's counts holds (GET /api/tickets/counts), "
					+ "measured against now")
			@RequestParam(required = false) @Nullable Attention attention,
			@RequestParam(defaultValue = "RECENTLY_UPDATED") TicketSort sort,
			@Parameter(description = "Counts from 0") @RequestParam(defaultValue = "0") int page,
			@Parameter(description = "1 to 100") @RequestParam(defaultValue = "20") int size) {
		var errors = new ArrayList<FieldError>();
		TicketPageRequest.validate(errors, page, size);
		TicketFilter.validate(errors, createdFrom, createdTo, deadlineBefore);
		Validations.throwIfInvalid(errors);
		var pageRequest = new TicketPageRequest(sort, page, size);
		var filter = new TicketFilter(text, organizationId, present(statuses), present(categories),
				present(priorities), teamId, assigneeId, slaBreached, authorId, createdFrom, createdTo,
				deadlineBefore, attention);
		return queries.list(callerId(authentication), filter, pageRequest);
	}

	@Operation(summary = "How many tickets each of support staff's list views holds and how many need a person now, "
			+ "over every ticket whatever a list's search or filters")
	@ApiResponse(responseCode = "200", description = "The counts")
	@ApiResponse(responseCode = "401", description = "Problem type slug: auth/unauthenticated",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "403", description = "Problem type slug: ticket/forbidden (a customer)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@GetMapping("/counts")
	TicketCounts counts(Authentication authentication) {
		return queries.counts(callerId(authentication));
	}

	@Operation(summary = "How many tickets each of a customer's list views holds, over their organization's tickets "
			+ "whatever a list's search or filters")
	@ApiResponse(responseCode = "200", description = "The counts")
	@ApiResponse(responseCode = "401", description = "Problem type slug: auth/unauthenticated",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "403", description = "Problem type slug: ticket/forbidden (support staff, who read "
			+ "/api/tickets/counts)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@GetMapping("/customer-counts")
	CustomerTicketCounts customerCounts(Authentication authentication) {
		return queries.customerCounts(callerId(authentication));
	}

	@Operation(summary = "A ticket with its conversation, audit history and links, as far as the signed-in user may "
			+ "see them")
	@ApiResponse(responseCode = "200", description = "The ticket",
			headers = @Header(name = "ETag", description = "The ticket's version in quotes, such as \"7\"",
					schema = @Schema(type = "string")))
	@ApiResponse(responseCode = "401", description = "Problem type slug: auth/unauthenticated",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "404", description = "Problem type slug: ticket/not-found (no such ticket, or one "
			+ "the signed-in user may not see: the two are indistinguishable on purpose)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@GetMapping("/{reference}")
	ResponseEntity<TicketDetails> details(Authentication authentication,
			@Parameter(example = "RET-1042") @PathVariable String reference) {
		var details = queries.find(callerId(authentication), reference)
				.orElseThrow(() -> TicketProblems.notFound(reference));
		return ResponseEntity.ok().eTag(EntityTags.format(details.version())).body(details);
	}

	@Operation(summary = "Open a ticket in the signed-in customer's organization")
	@ApiResponse(responseCode = "201", description = "The new ticket (or, for a replayed Idempotency-Key, that "
			+ "ticket as it is now)",
			headers = {
					@Header(name = "Location", description = "The ticket's URL, such as /api/tickets/RET-1042",
							schema = @Schema(type = "string")),
					@Header(name = "ETag", description = "The ticket's version in quotes, such as \"0\"",
							schema = @Schema(type = "string")) })
	@ApiResponse(responseCode = "400", description = "Problem type slug: malformed-request (a body that cannot be "
			+ "read)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "401", description = "Problem type slug: auth/unauthenticated",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "403", description = "Problem type slug: auth/forbidden (missing CSRF token) or "
			+ "ticket/forbidden (support staff do not create tickets)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "422", description = "Problem type slug: validation (errors[].code field.required, "
			+ "field.too-long, field.invalid, category.unknown or idempotencyKey.invalid) or idempotency/key-reused "
			+ "(the key was already used for a different request)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@PostMapping
	ResponseEntity<TicketDetails> create(Authentication authentication, @RequestBody CreateTicketRequest body,
			@Parameter(in = ParameterIn.HEADER, description = "1 to 255 visible ASCII characters; a retry with the "
					+ "same key and request replays the first answer instead of creating another ticket")
			@RequestHeader(name = IdempotencyKeys.HEADER, required = false) @Nullable String idempotencyKey) {
		var created = commands.create(callerId(authentication), body.title(), body.description(), body.category(),
				idempotencyKey);
		return ResponseEntity.status(HttpStatus.CREATED)
				.location(URI.create("/api/tickets/" + created.summary().reference()))
				.eTag(EntityTags.format(created.version()))
				.body(created);
	}

	@Operation(summary = "Add a public comment or, for support staff, an internal note; a public comment by support "
			+ "staff on a new ticket, or by a customer on one waiting for customer or resolved, moves it to IN_PROGRESS")
	@ApiResponse(responseCode = "201", description = "The ticket with the new comment (or, for a replayed "
			+ "Idempotency-Key, the ticket as it is now)",
			headers = @Header(name = "ETag", description = "The ticket's version in quotes, such as \"8\"",
					schema = @Schema(type = "string")))
	@ApiResponse(responseCode = "400", description = "Problem type slug: malformed-request (a body that cannot be "
			+ "read)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "401", description = "Problem type slug: auth/unauthenticated",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "403", description = "Problem type slug: auth/forbidden (missing CSRF token) or "
			+ "ticket/forbidden (customers do not add internal notes)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "404", description = "Problem type slug: ticket/not-found (no such ticket, or one "
			+ "the signed-in user may not see)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "409", description = "Problem type slug: ticket/closed (customers do not comment on a "
			+ "closed ticket)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "422", description = "Problem type slug: validation (errors[].code field.required, "
			+ "field.too-long, field.invalid or idempotencyKey.invalid) or idempotency/key-reused (the key was "
			+ "already used for a different request)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@PostMapping("/{reference}/comments")
	ResponseEntity<TicketDetails> addComment(Authentication authentication,
			@Parameter(example = "RET-1042") @PathVariable String reference, @RequestBody AddCommentRequest body,
			@Parameter(in = ParameterIn.HEADER, description = "1 to 255 visible ASCII characters; a retry with the "
					+ "same key and request replays the first answer instead of adding another comment")
			@RequestHeader(name = IdempotencyKeys.HEADER, required = false) @Nullable String idempotencyKey) {
		var details = commands.addComment(callerId(authentication), reference, body.body(), body.internal(),
				idempotencyKey);
		return ResponseEntity.status(HttpStatus.CREATED).eTag(EntityTags.format(details.version())).body(details);
	}

	@Operation(summary = "Close a ticket, optionally with a resolution: its author from any status, support staff "
			+ "once it is resolved")
	@ApiResponse(responseCode = "200", description = "The closed ticket (as it is, with its current ETag and whatever "
			+ "If-Match, when it is already closed and the request sends no other resolution)",
			headers = @Header(name = "ETag", description = "The ticket's version in quotes, such as \"8\"",
					schema = @Schema(type = "string")))
	@ApiResponse(responseCode = "400", description = "Problem type slug: malformed-request (a body that cannot be "
			+ "read)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "401", description = "Problem type slug: auth/unauthenticated",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "403", description = "Problem type slug: auth/forbidden (missing CSRF token) or "
			+ "ticket/forbidden (a customer closes only a ticket they raised)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "404", description = "Problem type slug: ticket/not-found (no such ticket, or one "
			+ "the signed-in user may not see)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "409", description = "Problem type slug: ticket/already-closed (the current version "
			+ "is already closed with another resolution than the one sent) or ticket/not-resolved (support staff "
			+ "close only a resolved ticket)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "412", description = "Problem type slug: ticket/modified (a change whose If-Match is "
			+ "not the current ETag; `*`, weak tags and lists never match)",
			headers = @Header(name = "ETag", description = "The ticket's current version in quotes",
					schema = @Schema(type = "string")),
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "422", description = "Problem type slug: validation (errors[].code field.too-long "
			+ "or field.invalid)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "428", description = "Problem type slug: ticket/precondition-required (a change "
			+ "without If-Match)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@PostMapping("/{reference}/close")
	ResponseEntity<TicketDetails> close(Authentication authentication,
			@Parameter(example = "RET-1042") @PathVariable String reference,
			@RequestBody(required = false) @Nullable CloseTicketRequest body,
			@Parameter(in = ParameterIn.HEADER, required = true, description = "The ticket's current ETag, such as "
					+ "\"7\"")
			@RequestHeader(name = HttpHeaders.IF_MATCH, required = false) @Nullable String ifMatch) {
		var details = commands.close(callerId(authentication), reference, body == null ? null : body.resolution(),
				ifMatch);
		return ResponseEntity.ok().eTag(EntityTags.format(details.version())).body(details);
	}

	@Operation(summary = "Edit a ticket's title and description (its author while it is NEW, support staff until it "
			+ "is closed), or change its status, resolution, priority, category, team or assignee (support staff); a "
			+ "body sends one group or the other, and its fields follow merge-patch rules: absent keeps, null clears")
	@ApiResponse(responseCode = "200", description = "The ticket (unchanged, with the same ETag and whatever If-Match, "
			+ "when nothing changed)",
			headers = @Header(name = "ETag", description = "The ticket's version in quotes, such as \"8\"",
					schema = @Schema(type = "string")))
	@ApiResponse(responseCode = "400", description = "Problem type slug: malformed-request (a body that is not a JSON "
			+ "object, a title, description, status, priority or category that is not a string, or a teamId or "
			+ "assigneeId that is not a UUID string)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "401", description = "Problem type slug: auth/unauthenticated",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "403", description = "Problem type slug: auth/forbidden (missing CSRF token) or "
			+ "ticket/forbidden (a customer edits only the title and description of a ticket they raised)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "404", description = "Problem type slug: ticket/not-found (no such ticket, or one "
			+ "the signed-in user may not see)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "409", description = "Problem type slug: ticket/closed (an edit that would change a "
			+ "closed ticket) or ticket/not-editable (the author editing the title or description of a ticket past "
			+ "NEW; a correction is a comment)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "412", description = "Problem type slug: ticket/modified (a change whose If-Match is "
			+ "not the current ETag; `*`, weak tags and lists never match)",
			headers = @Header(name = "ETag", description = "The ticket's current version in quotes",
					schema = @Schema(type = "string")),
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "422", description = "Problem type slug: validation (errors[].code field.required, "
			+ "field.too-long, field.invalid, field.not-combinable, status.closed, status.not-allowed, "
			+ "resolution.not-resolved, "
			+ "status.unknown, priority.unknown, category.unknown, teamId.unknown, assigneeId.unknown "
			+ "or assigneeId.not-in-team)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "428", description = "Problem type slug: ticket/precondition-required (a change "
			+ "without If-Match)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@PatchMapping(path = "/{reference}", consumes = MediaType.APPLICATION_JSON_VALUE)
	ResponseEntity<TicketDetails> update(Authentication authentication,
			@Parameter(example = "RET-1042") @PathVariable String reference,
			@io.swagger.v3.oas.annotations.parameters.RequestBody(required = true,
					content = @Content(mediaType = MediaType.APPLICATION_JSON_VALUE,
							schema = @Schema(implementation = UpdateTicketRequest.class)))
			@RequestBody Map<String, @Nullable Object> body,
			@Parameter(in = ParameterIn.HEADER, required = true, description = "The ticket's current ETag, such as "
					+ "\"7\"")
			@RequestHeader(name = HttpHeaders.IF_MATCH, required = false) @Nullable String ifMatch,
			HttpServletRequest request) {
		var title = text(body, "title", request);
		var description = text(body, "description", request);
		var changes = new TicketChanges(text(body, "status", request), text(body, "priority", request),
				text(body, "category", request), id(body, "teamId", request), id(body, "assigneeId", request),
				text(body, "resolution", request));
		var editsContent = !(title instanceof Field.Absent<String> && description instanceof Field.Absent<String>);
		if (editsContent && !changes.isEmpty()) {
			refuseCombined(title, description);
		}
		var details = editsContent ? commands.edit(callerId(authentication), reference, title, description, ifMatch)
				: commands.update(callerId(authentication), reference, changes, ifMatch);
		return ResponseEntity.ok().eTag(EntityTags.format(details.version())).body(details);
	}

	@Operation(summary = "Link two tickets (support staff), or switch the type of their link; either ticket may be "
			+ "addressed")
	@ApiResponse(responseCode = "200", description = "The addressed ticket (unchanged, with the same ETag, when the "
			+ "link already has that type)",
			headers = @Header(name = "ETag", description = "The ticket's version in quotes, such as \"8\"",
					schema = @Schema(type = "string")))
	@ApiResponse(responseCode = "400", description = "Problem type slug: malformed-request (a body that cannot be "
			+ "read)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "401", description = "Problem type slug: auth/unauthenticated",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "403", description = "Problem type slug: auth/forbidden (missing CSRF token) or "
			+ "ticket/forbidden (customers do not link tickets)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "404", description = "Problem type slug: ticket/not-found (no such ticket at either "
			+ "reference, or one the signed-in user may not see; the detail names that reference)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "422", description = "Problem type slug: validation (errors[].code field.required, "
			+ "type.unknown or linkedReference.self)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@PutMapping("/{reference}/links/{linkedReference}")
	ResponseEntity<TicketDetails> link(Authentication authentication,
			@Parameter(example = "RET-1042") @PathVariable String reference,
			@Parameter(example = "RET-1001") @PathVariable String linkedReference,
			@RequestBody LinkTicketRequest body) {
		var details = commands.link(callerId(authentication), reference, linkedReference, body.type());
		return ResponseEntity.ok().eTag(EntityTags.format(details.version())).body(details);
	}

	@Operation(summary = "Remove the link between two tickets (support staff); either ticket may be addressed")
	@ApiResponse(responseCode = "200", description = "The addressed ticket (unchanged, with the same ETag, when there "
			+ "was no link)",
			headers = @Header(name = "ETag", description = "The ticket's version in quotes, such as \"8\"",
					schema = @Schema(type = "string")))
	@ApiResponse(responseCode = "401", description = "Problem type slug: auth/unauthenticated",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "403", description = "Problem type slug: auth/forbidden (missing CSRF token) or "
			+ "ticket/forbidden (customers do not unlink tickets)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "404", description = "Problem type slug: ticket/not-found (no such ticket at either "
			+ "reference, or one the signed-in user may not see; the detail names that reference)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "422", description = "Problem type slug: validation (errors[].code "
			+ "linkedReference.self)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@DeleteMapping("/{reference}/links/{linkedReference}")
	ResponseEntity<TicketDetails> unlink(Authentication authentication,
			@Parameter(example = "RET-1042") @PathVariable String reference,
			@Parameter(example = "RET-1001") @PathVariable String linkedReference) {
		var details = commands.unlink(callerId(authentication), reference, linkedReference);
		return ResponseEntity.ok().eTag(EntityTags.format(details.version())).body(details);
	}

	/// Editing the content and changing the other fields are separate commands, each with its own permission, so a
	/// PATCH body sends one group or the other. The refusal names each content field sent and depends on the body
	/// alone, so it comes before the ticket is looked up.
	private static void refuseCombined(Field<String> title, Field<String> description) {
		var errors = new ArrayList<FieldError>();
		if (!(title instanceof Field.Absent<String>)) {
			errors.add(notCombinable("title"));
		}
		if (!(description instanceof Field.Absent<String>)) {
			errors.add(notCombinable("description"));
		}
		Validations.throwIfInvalid(errors);
	}

	private static FieldError notCombinable(String field) {
		return new FieldError(field, "field.not-combinable", "Send the title and description without other fields.");
	}

	/// A field of the PATCH body that must be a string when present. A wrong JSON type is the same mistake as an
	/// unreadable body and answers the same 400, before the ticket is looked up.
	private static Field<String> text(Map<String, @Nullable Object> body, String name, HttpServletRequest request) {
		if (!body.containsKey(name)) {
			return new Field.Absent<>();
		}
		return switch (body.get(name)) {
			case null -> new Field.Cleared<>();
			case String value -> new Field.Present<>(value);
			default -> throw malformed(name, request);
		};
	}

	/// As [#text], for a field that must be a UUID string in its canonical form.
	private static Field<UUID> id(Map<String, @Nullable Object> body, String name, HttpServletRequest request) {
		return switch (text(body, name, request)) {
			case Field.Absent<String> _ -> new Field.Absent<>();
			case Field.Cleared<String> _ -> new Field.Cleared<>();
			case Field.Present<String>(var value) -> new Field.Present<>(parseUuid(value, name, request));
		};
	}

	private static UUID parseUuid(String value, String name, HttpServletRequest request) {
		try {
			var id = UUID.fromString(value);
			if (id.toString().equalsIgnoreCase(value)) {
				return id;
			}
		}
		catch (IllegalArgumentException ex) {
			// Falls through to the 400 below.
		}
		throw malformed(name, request);
	}

	private static HttpMessageNotReadableException malformed(String name, HttpServletRequest request) {
		return new HttpMessageNotReadableException("PATCH body field '" + name + "' has the wrong JSON type",
				new ServletServerHttpRequest(request));
	}

	/// Spring binds a blank value (`status=`) to a `null` element; like blank text, it narrows nothing.
	private static <T> Set<T> present(@Nullable Set<@Nullable T> values) {
		return values == null ? Set.of()
				: values.stream().filter(Objects::nonNull).collect(Collectors.toUnmodifiableSet());
	}

}
