package app.retrofit.ticket;

import static app.retrofit.ticket.TicketStatus.CLOSED;
import static app.retrofit.ticket.TicketStatus.IN_PROGRESS;
import static app.retrofit.ticket.TicketStatus.NEW;
import static app.retrofit.ticket.TicketStatus.RESOLVED;
import static app.retrofit.ticket.TicketStatus.WAITING_FOR_CUSTOMER;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

/// The moves support staff may make, as ADR 0004 lists them.
class TicketStatusTests {

	@Test
	void supportMovesFollowTheLifecycle() {
		var allowed = Map.of(
				NEW, Set.of(IN_PROGRESS, WAITING_FOR_CUSTOMER, RESOLVED),
				IN_PROGRESS, Set.of(WAITING_FOR_CUSTOMER, RESOLVED),
				WAITING_FOR_CUSTOMER, Set.of(IN_PROGRESS, RESOLVED),
				RESOLVED, Set.of(IN_PROGRESS),
				CLOSED, Set.<TicketStatus>of());

		for (var from : TicketStatus.values()) {
			var targets = EnumSet.noneOf(TicketStatus.class);
			Arrays.stream(TicketStatus.values()).filter(from::canMoveTo).forEach(targets::add);
			assertThat(targets).as("from %s", from).isEqualTo(allowed.get(from));
		}
	}

}
