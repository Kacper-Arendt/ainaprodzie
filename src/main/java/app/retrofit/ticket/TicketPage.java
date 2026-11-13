package app.retrofit.ticket;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

record TicketPage(@Schema(requiredMode = REQUIRED) List<TicketSummary> items,
		@Schema(requiredMode = REQUIRED, description = "Tickets on all pages together") long total) {
}
