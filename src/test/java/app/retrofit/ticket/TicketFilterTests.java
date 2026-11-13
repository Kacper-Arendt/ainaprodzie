package app.retrofit.ticket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import java.time.Instant;
import java.util.List;

import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.Test;

import app.retrofit.platform.FieldError;
import app.retrofit.platform.ProblemException;

/// The checks [TicketFilter] makes on its own, for every caller; what a filter selects is covered by
/// [TicketQueriesTests].
class TicketFilterTests {

	private static final Instant NOON = Instant.parse("2026-10-14T12:00:00Z");

	private static final Instant YEAR_10000 = Instant.parse("+10000-01-01T00:00:00Z");

	private static final Instant YEAR_ZERO = Instant.parse("0000-12-31T23:59:59.999999Z");

	@Test
	void creationRangeThatStartsAfterItEndsIsAValidationProblem() {
		assertThat(validationCodes(() -> new FilterBuilder().withCreatedFrom(NOON).withCreatedTo(NOON.minusSeconds(1))
				.build())).containsExactly("createdTo.invalid");
	}

	@Test
	void instantsOutsideTheYearsOneTo9999AreAValidationProblemNamingTheField() {
		assertThat(validationCodes(() -> new FilterBuilder().withCreatedFrom(YEAR_10000).withCreatedTo(YEAR_ZERO)
				.withDeadlineBefore(YEAR_10000).build()))
				.containsExactlyInAnyOrder("createdFrom.invalid", "createdTo.invalid", "deadlineBefore.invalid");
	}

	@Test
	void anInvertedCreationRangeIsReportedNextToAnUnstorableDeadline() {
		assertThat(validationCodes(() -> new FilterBuilder().withCreatedFrom(NOON).withCreatedTo(NOON.minusSeconds(1))
				.withDeadlineBefore(YEAR_10000).build()))
				.containsExactlyInAnyOrder("deadlineBefore.invalid", "createdTo.invalid");
	}

	@Test
	void anUnstorableRangeBoundIsReportedAloneRatherThanAsAnInvertedRange() {
		assertThat(validationCodes(() -> new FilterBuilder().withCreatedFrom(YEAR_10000).withCreatedTo(NOON).build()))
				.containsExactly("createdFrom.invalid");
	}

	@SuppressWarnings("unchecked")
	private static List<String> validationCodes(ThrowingCallable call) {
		var problem = catchThrowableOfType(ProblemException.class, call);
		assertThat(problem).as("a validation problem").isNotNull();
		assertThat(problem.getBody().getType().toString()).endsWith("/validation");
		var errors = (List<FieldError>) problem.getBody().getProperties().get("errors");
		return errors.stream().map(FieldError::code).toList();
	}

}
