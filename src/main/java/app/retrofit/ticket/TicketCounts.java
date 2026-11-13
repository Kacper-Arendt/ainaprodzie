package app.retrofit.ticket;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;

/// The support desk at a glance: how many tickets each of support staff's list views holds, and how many need a
/// person now, each of those as the list filter of its [Attention] keeps them. Every count is over all the tickets
/// the caller may see, whatever a list's search or filters.
record TicketCounts(@Schema(requiredMode = REQUIRED, description = "Every ticket") long all,
		@Schema(requiredMode = REQUIRED, description = "Tickets assigned to the signed-in support member")
		long assignedToMe,
		@Schema(requiredMode = REQUIRED, description = "Tickets of the signed-in support member's team")
		long myTeam,
		@Schema(requiredMode = REQUIRED, description = "Tickets still awaiting a first response, not closed, past "
				+ "their response deadline") long pastDeadline,
		@Schema(requiredMode = REQUIRED, description = "Tickets still awaiting a first response, not closed, whose "
				+ "response deadline falls within the next hour") long dueWithinHour,
		@Schema(requiredMode = REQUIRED, description = "Tickets neither resolved nor closed without an assignee")
		long unassigned,
		@Schema(requiredMode = REQUIRED, description = "Tickets with an unanswered customer comment: the latest "
				+ "public comment, by a customer, on a ticket in progress after its first response")
		long unansweredCustomerComment) {
}
