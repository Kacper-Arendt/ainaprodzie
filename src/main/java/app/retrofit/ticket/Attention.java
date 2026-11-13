package app.retrofit.ticket;

/// What on the support desk needs a person now. Each is one of [TicketCounts]' desk counts and a list filter that
/// keeps exactly the tickets that count holds.
enum Attention {

	/// A live SLA breach: still awaiting a first response, not closed, past the response deadline.
	PAST_DEADLINE,

	/// Still awaiting a first response, not closed, with the response deadline within the next hour.
	DUE_WITHIN_HOUR,

	/// An unanswered customer comment: support staff owe the next public comment.
	UNANSWERED_CUSTOMER_COMMENT,

	/// Neither resolved nor closed, without an assignee.
	UNASSIGNED

}
