package app.retrofit.ticket;

import static app.retrofit.ticket.TicketStatus.CLOSED;
import static app.retrofit.ticket.TicketStatus.IN_PROGRESS;
import static app.retrofit.ticket.TicketStatus.NEW;
import static app.retrofit.ticket.TicketStatus.RESOLVED;
import static app.retrofit.ticket.TicketStatus.WAITING_FOR_CUSTOMER;
import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

/// The transitions a command asks of a ticket and the history entries they make.
class TicketTests {

	private static final Instant NOW = Instant.parse("2026-10-22T10:00:00Z");

	private static final Instant EARLIER = Instant.parse("2026-10-21T10:00:00Z");

	private static final NamedRef BILLING = new NamedRef(UUID.randomUUID(), "Billing");

	private static final NamedRef ANNA = new NamedRef(UUID.randomUUID(), "Anna");

	@Test
	void changesListEveryChangedFieldInHistoryOrder() {
		var before = ticket(NEW, null);
		var after = before.withContent("Charged twice", "Two invoices.")
				.withFacts(RESOLVED, "Refunded.", TicketPriority.HIGH, TicketCategory.BUG, BILLING, ANNA);

		assertThat(before.changesTo(after)).containsExactly(
				new Ticket.Change(AuditedField.TITLE, "Login fails", "Charged twice"),
				new Ticket.Change(AuditedField.DESCRIPTION, "Since Monday.", "Two invoices."),
				new Ticket.Change(AuditedField.STATUS, "NEW", "RESOLVED"),
				new Ticket.Change(AuditedField.RESOLUTION, null, "Refunded."),
				new Ticket.Change(AuditedField.PRIORITY, "NORMAL", "HIGH"),
				new Ticket.Change(AuditedField.CATEGORY, null, "BUG"),
				new Ticket.Change(AuditedField.TEAM, null, "Billing"),
				new Ticket.Change(AuditedField.ASSIGNEE, null, "Anna"));
	}

	@Test
	void teamAndAssigneeAreComparedById() {
		var before = ticket(IN_PROGRESS, null).withFacts(IN_PROGRESS, null, TicketPriority.NORMAL, null, BILLING, ANNA);
		var renamed = before.withFacts(IN_PROGRESS, null, TicketPriority.NORMAL, null,
				new NamedRef(BILLING.id(), "Payments"), new NamedRef(ANNA.id(), "Anna K."));

		assertThat(before.changesTo(renamed)).isEmpty();
	}

	@Test
	void closingWithoutAResolutionKeepsTheStoredOne() {
		var closed = ticket(RESOLVED, "Refunded.").closed(null, NOW);

		assertThat(closed.status()).isEqualTo(CLOSED);
		assertThat(closed.resolution()).isEqualTo("Refunded.");
		assertThat(closed.closedAt()).isEqualTo(NOW);
	}

	@Test
	void closingWithAResolutionReplacesTheStoredOne() {
		var closed = ticket(RESOLVED, "Refunded.").closed("Refunded twice.", NOW);

		assertThat(closed.resolution()).isEqualTo("Refunded twice.");
	}

	@Test
	void closingAClosedTicketKeepsItsClosingTimeAndChangesNothing() {
		var closedEarlier = ticket(RESOLVED, "Refunded.").closed(null, EARLIER);

		var closedAgain = closedEarlier.closed(null, NOW);

		assertThat(closedAgain.closedAt()).isEqualTo(EARLIER);
		assertThat(closedEarlier.changesTo(closedAgain)).isEmpty();
	}

	@Test
	void aPublicCommentHandsTheTicketToWhoeverActsNext() {
		var afterSupportReply = Map.of(NEW, IN_PROGRESS, IN_PROGRESS, IN_PROGRESS,
				WAITING_FOR_CUSTOMER, WAITING_FOR_CUSTOMER, RESOLVED, RESOLVED, CLOSED, CLOSED);
		var afterCustomerComment = Map.of(NEW, NEW, IN_PROGRESS, IN_PROGRESS,
				WAITING_FOR_CUSTOMER, IN_PROGRESS, RESOLVED, IN_PROGRESS, CLOSED, CLOSED);

		for (var status : TicketStatus.values()) {
			var ticket = ticket(status, null);
			assertThat(ticket.commented(true, false, NOW).status()).as("support reply on %s", status)
					.isEqualTo(afterSupportReply.get(status));
			assertThat(ticket.commented(false, false, NOW).status()).as("customer comment on %s", status)
					.isEqualTo(afterCustomerComment.get(status));
		}
	}

	@Test
	void anInternalNoteChangesNothing() {
		for (var status : TicketStatus.values()) {
			var ticket = ticket(status, null);
			assertThat(ticket.commented(true, true, NOW)).as("note on %s", status).isEqualTo(ticket);
		}
	}

	@Test
	void supportsFirstPublicReplyIsTheFirstResponse() {
		var answered = ticket(NEW, null).commented(true, false, NOW);

		assertThat(answered.firstResponseAt()).isEqualTo(NOW);
		assertThat(answered.commented(true, false, NOW.plusSeconds(60)).firstResponseAt()).isEqualTo(NOW);
	}

	@Test
	void aReplyOnAClosedTicketIsNoFirstResponse() {
		assertThat(ticket(CLOSED, null).commented(true, false, NOW).firstResponseAt()).isNull();
	}

	@Test
	void aCustomerCommentIsNoFirstResponse() {
		assertThat(ticket(NEW, null).commented(false, false, NOW).firstResponseAt()).isNull();
	}

	private static Ticket ticket(TicketStatus status, @Nullable String resolution) {
		return new Ticket(UUID.randomUUID(), 1042, 0, UUID.randomUUID(), "Login fails", "Since Monday.", status,
				TicketPriority.NORMAL, null, null, null, resolution, null, status == CLOSED ? EARLIER : null);
	}

}
