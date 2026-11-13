package app.retrofit.ticket;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;

/// How many tickets each of a customer's list views holds: their organization's tickets, those awaiting a customer's
/// answer and those the customer raised. Every count is over the organization's tickets, whatever a list's search or
/// filters.
record CustomerTicketCounts(@Schema(requiredMode = REQUIRED, description = "Every ticket of the organization")
		long all,
		@Schema(requiredMode = REQUIRED, description = "The organization's tickets waiting for customer: support "
				+ "staff await an answer") long waitingForCustomer,
		@Schema(requiredMode = REQUIRED, description = "Tickets the signed-in customer raised") long raisedByMe) {
}
