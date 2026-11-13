package app.retrofit.ticket;

import app.retrofit.platform.ProblemException;

final class TicketProblems {

	private TicketProblems() {
	}

	/// The one body for a missing ticket and for one the caller may not see, so neither reveals which it was.
	static ProblemException notFound(String reference) {
		return ProblemException.notFound("ticket/not-found", "Ticket not found",
				"There is no ticket " + reference + " you can see.");
	}

	/// The caller may see the ticket (or, for create, is signed in) but this operation is not open to their role.
	static ProblemException forbidden() {
		return ProblemException.forbidden("ticket/forbidden", "Operation not allowed",
				"Your role does not allow this operation.");
	}

	/// A customer writing to a closed ticket; support may still comment on it.
	static ProblemException closed(String reference) {
		return ProblemException.conflict("ticket/closed", "Ticket closed",
				"Ticket " + reference + " is closed. To follow up, create a new ticket.");
	}

	/// The author editing a ticket that is past NEW: support staff are working from its text, so a correction is a
	/// comment.
	static ProblemException notEditable(String reference) {
		return ProblemException.conflict("ticket/not-editable", "Ticket not editable",
				"Support is already working on ticket " + reference + ". Add a comment instead.");
	}

	/// Closing a ticket that is already closed, from its current version.
	static ProblemException alreadyClosed(String reference) {
		return ProblemException.conflict("ticket/already-closed", "Ticket already closed",
				"Ticket " + reference + " is already closed.");
	}

	/// Support staff closing a ticket that is not resolved: every closed ticket says why it ended.
	static ProblemException notResolved(String reference) {
		return ProblemException.conflict("ticket/not-resolved", "Ticket not resolved",
				"Resolve ticket " + reference + " before closing it.");
	}

	/// The `If-Match` does not name the ticket's current version; `version` is that version, sent back as the `ETag`.
	static ProblemException modified(long version) {
		return ProblemException.preconditionFailed("ticket/modified", "Ticket modified",
				"The ticket changed after you read it. Reload it and try again.", EntityTags.format(version));
	}

	/// A conditional write sent without `If-Match`.
	static ProblemException preconditionRequired() {
		return ProblemException.preconditionRequired("ticket/precondition-required", "If-Match required",
				"Send the ticket's current ETag in If-Match.");
	}

	/// The `Idempotency-Key` already stands for another request of this user: another payload, operation or ticket.
	static ProblemException keyReused() {
		return ProblemException.unprocessable("idempotency/key-reused", "Idempotency key reused",
				"This Idempotency-Key was already used for a different request.");
	}

}
