package app.retrofit.ticket;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

import org.jspecify.annotations.Nullable;

/// A ticket as a write decides on it, read only when the caller may see it. Each command turns it into the ticket it
/// asks for, and [#changesTo] names what that changes, which is both the audit history and the test of a command that
/// changes nothing (ADR 0003). Who may make a change, and in which status, is the command's to check.
record Ticket(UUID id, long number, long version, UUID authorId, String title, String description,
		TicketStatus status, TicketPriority priority, @Nullable TicketCategory category, @Nullable NamedRef team,
		@Nullable NamedRef assignee, @Nullable String resolution, @Nullable Instant firstResponseAt,
		@Nullable Instant closedAt) {

	String reference() {
		return new TicketReference(number).toString();
	}

	Ticket withContent(String title, String description) {
		return new Ticket(id, number, version, authorId, title, description, status, priority, category, team,
				assignee, resolution, firstResponseAt, closedAt);
	}

	Ticket withFacts(TicketStatus status, @Nullable String resolution, TicketPriority priority,
			@Nullable TicketCategory category, @Nullable NamedRef team, @Nullable NamedRef assignee) {
		return new Ticket(id, number, version, authorId, title, description, status, priority, category, team,
				assignee, resolution, firstResponseAt, closedAt);
	}

	/// A `null` resolution keeps the stored one. A ticket closed before keeps its closing time.
	Ticket closed(@Nullable String resolution, Instant now) {
		return new Ticket(id, number, version, authorId, title, description, TicketStatus.CLOSED, priority, category,
				team, assignee, resolution == null ? this.resolution : resolution, firstResponseAt,
				closedAt == null ? now : closedAt);
	}

	/// The ticket after a comment (ADR 0004). A public comment hands it to whoever acts next: support's first reply
	/// takes up a new ticket, and a customer's comment on a ticket waiting for customer or resolved is the awaited
	/// answer or a sign the resolution did not work. Support's earliest public reply is the first response, except on
	/// a closed ticket, which keeps the waiting time and SLA it closed with. An internal note changes nothing.
	Ticket commented(boolean fromSupport, boolean note, Instant now) {
		if (note) {
			return this;
		}
		var next = switch (status) {
			case NEW -> fromSupport ? TicketStatus.IN_PROGRESS : status;
			case WAITING_FOR_CUSTOMER, RESOLVED -> fromSupport ? status : TicketStatus.IN_PROGRESS;
			case IN_PROGRESS, CLOSED -> status;
		};
		var firstResponse = fromSupport && status != TicketStatus.CLOSED && firstResponseAt == null ? now
				: firstResponseAt;
		return new Ticket(id, number, version, authorId, title, description, next, priority, category, team, assignee,
				resolution, firstResponse, closedAt);
	}

	/// The audited fields that differ in `after`, in history order, with the text snapshots the history shows. Team
	/// and assignee are compared by id, so an assignee change between namesakes is a change whose two snapshots are
	/// equal.
	List<Change> changesTo(Ticket after) {
		var changes = new ArrayList<Change>();
		if (!title.equals(after.title)) {
			changes.add(new Change(AuditedField.TITLE, title, after.title));
		}
		if (!description.equals(after.description)) {
			changes.add(new Change(AuditedField.DESCRIPTION, description, after.description));
		}
		if (status != after.status) {
			changes.add(new Change(AuditedField.STATUS, status.name(), after.status.name()));
		}
		if (!Objects.equals(resolution, after.resolution)) {
			changes.add(new Change(AuditedField.RESOLUTION, resolution, after.resolution));
		}
		if (priority != after.priority) {
			changes.add(new Change(AuditedField.PRIORITY, priority.name(), after.priority.name()));
		}
		if (category != after.category) {
			changes.add(new Change(AuditedField.CATEGORY, nameOf(category), nameOf(after.category)));
		}
		if (!Objects.equals(idOf(team), idOf(after.team))) {
			changes.add(new Change(AuditedField.TEAM, nameOf(team), nameOf(after.team)));
		}
		if (!Objects.equals(idOf(assignee), idOf(after.assignee))) {
			changes.add(new Change(AuditedField.ASSIGNEE, nameOf(assignee), nameOf(after.assignee)));
		}
		return changes;
	}

	static @Nullable UUID idOf(@Nullable NamedRef ref) {
		return ref == null ? null : ref.id();
	}

	private static @Nullable String nameOf(@Nullable NamedRef ref) {
		return ref == null ? null : ref.name();
	}

	static @Nullable String nameOf(@Nullable Enum<?> value) {
		return value == null ? null : value.name();
	}

	/// One entry of the audit history, with the text snapshots it shows.
	record Change(AuditedField field, @Nullable String oldValue, @Nullable String newValue) {
	}

}
