package app.retrofit.platform;

import java.time.Instant;
import java.util.List;

import org.jspecify.annotations.Nullable;

/// Field-level validation helpers. Collecting [FieldError]s into a list before throwing lets one request report
/// every problem at once. The codes are a contract the frontend translates and must not drift.
public final class Validations {

	private static final Instant EARLIEST_STORABLE = Instant.parse("0001-01-01T00:00:00Z");

	private static final Instant AFTER_LATEST_STORABLE = Instant.parse("+10000-01-01T00:00:00Z");

	private Validations() {
	}

	/// Range check for an instant compared with a `timestamptz` column, returning the instant, or `null` when it is
	/// absent (which passes) or refused: one whose UTC year lies outside 1 to 9999 is `<field>.invalid`. Those years have one plain four-digit form everywhere: a later year
	/// needs ISO-8601's signed, expanded form (`+10000-01-01T00:00:00Z`), and year 0 and earlier are BC years, which
	/// PostgreSQL writes as `0001 BC` for ISO's year 0. [Instant] itself reaches the year one billion, beyond
	/// PostgreSQL's 294276.
	public static @Nullable Instant requireStorableInstant(List<FieldError> errors, String field,
			@Nullable Instant instant) {
		if (instant != null && (instant.isBefore(EARLIEST_STORABLE) || !instant.isBefore(AFTER_LATEST_STORABLE))) {
			errors.add(new FieldError(field, field + ".invalid", "Must lie in the years 1 to 9999 (UTC)."));
			return null;
		}
		return instant;
	}

	/// Allowlist check; blank or absent is `field.required`, anything else unknown is `<field>.unknown`.
	public static String requireAllowed(List<FieldError> errors, String field, String value, List<String> allowed) {
		if (value == null || value.isBlank()) {
			errors.add(new FieldError(field, "field.required", "Must not be blank."));
			return null;
		}
		if (!allowed.contains(value)) {
			errors.add(new FieldError(field, field + ".unknown", "Must be one of " + String.join(", ", allowed) + "."));
			return null;
		}
		return value;
	}

	public static void throwIfInvalid(List<FieldError> errors) {
		if (!errors.isEmpty()) {
			throw ProblemException.validation(errors);
		}
	}

}
