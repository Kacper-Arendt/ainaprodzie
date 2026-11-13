package app.retrofit.ticket;

import java.util.UUID;
import java.util.stream.Stream;

/// A support edit read as a merge patch: each field is absent (keep it), `null` (clear it) or a value. The strings
/// are unchecked; the command validates them against its vocabulary.
record TicketChanges(Field<String> status, Field<String> priority, Field<String> category, Field<UUID> teamId,
		Field<UUID> assigneeId, Field<String> resolution) {

	/// Whether the edit sends none of its fields.
	boolean isEmpty() {
		return Stream.of(status, priority, category, teamId, assigneeId, resolution)
				.allMatch(Field.Absent.class::isInstance);
	}

	sealed interface Field<T> {

		record Absent<T>() implements Field<T> {
		}

		record Cleared<T>() implements Field<T> {
		}

		record Present<T>(T value) implements Field<T> {
		}

	}

}
