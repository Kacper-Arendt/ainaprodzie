package app.retrofit.ticket;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

import org.jspecify.annotations.Nullable;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import app.retrofit.platform.FieldError;
import tools.jackson.databind.json.JsonMapper;

/// `Idempotency-Key` claims for create and comment, scoped per user. A request claims its key inside the command's
/// transaction before writing and fills in the outcome after it, so a refusal rolls the claim back and only successful
/// writes are remembered.
@Component
class IdempotencyKeys {

	static final String HEADER = "Idempotency-Key";

	private static final Pattern VISIBLE_ASCII = Pattern.compile("[\\x21-\\x7E]{1,255}");

	private final JdbcClient jdbc;

	private final JsonMapper json;

	IdempotencyKeys(JdbcClient jdbc, JsonMapper json) {
		this.jdbc = jdbc;
		this.json = json;
	}

	/// An absent key is valid: the request is then simply not idempotent.
	static void validate(List<FieldError> errors, @Nullable String key) {
		if (key != null && !VISIBLE_ASCII.matcher(key).matches()) {
			errors.add(new FieldError(HEADER, "idempotencyKey.invalid", "Must be 1 to 255 visible ASCII characters."));
		}
	}

	/// The hex SHA-256 of `[operation, reference, ...fields]` written as a JSON array, so neither the request's JSON
	/// layout nor a value that spans a field boundary (`"a"`, `"b c"` against `"a b"`, `"c"`) can make two requests
	/// look alike. `fields` are the normalized values in a fixed order.
	String requestHash(String operation, @Nullable String reference, @Nullable Object... fields) {
		var canonical = new ArrayList<@Nullable Object>();
		canonical.add(operation);
		canonical.add(reference);
		canonical.addAll(Arrays.asList(fields));
		try {
			var digest = MessageDigest.getInstance("SHA-256")
					.digest(json.writeValueAsString(canonical).getBytes(StandardCharsets.UTF_8));
			return HexFormat.of().formatHex(digest);
		}
		catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException("Every Java platform provides SHA-256", ex);
		}
	}

	/// Claims `key` for this request, or returns the outcome to replay when an earlier request of the same user with
	/// the same hash already succeeded under it. Empty means this request owns the key and must [#fill] it after its
	/// write. A key held by an uncommitted request makes Postgres wait here until that request ends: a commit then
	/// reads as an existing key, a rollback lets this claim through.
	Optional<Replay> claim(UUID userId, String key, String requestHash, Instant now) {
		var claimed = jdbc.sql("""
				INSERT INTO idempotency_key (user_id, key, request_hash, created_at)
				VALUES (:userId, :key, :requestHash, :createdAt)
				ON CONFLICT (user_id, key) DO NOTHING
				""")
				.param("userId", userId)
				.param("key", key)
				.param("requestHash", requestHash)
				.param("createdAt", Timestamp.from(now))
				.update();
		if (claimed == 1) {
			return Optional.empty();
		}
		var earlier = jdbc.sql("""
				SELECT k.request_hash, t.number
				FROM idempotency_key k
				JOIN ticket t ON t.id = k.ticket_id
				WHERE k.user_id = :userId AND k.key = :key
				""")
				.param("userId", userId)
				.param("key", key)
				.query((rs, rowNum) -> new Stored(rs.getString("request_hash"),
						new Replay(new TicketReference(rs.getLong("number")).toString())))
				.single();
		if (!earlier.requestHash().equals(requestHash)) {
			throw TicketProblems.keyReused();
		}
		return Optional.of(earlier.replay());
	}

	/// Records the outcome of the write that owns `key`, in the same transaction as the claim.
	void fill(UUID userId, String key, UUID ticketId, @Nullable UUID commentId, int responseStatus) {
		jdbc.sql("""
				UPDATE idempotency_key SET ticket_id = :ticketId, comment_id = :commentId, response_status = :status
				WHERE user_id = :userId AND key = :key
				""")
				.param("ticketId", ticketId)
				.param("commentId", commentId, Types.OTHER)
				.param("status", responseStatus)
				.param("userId", userId)
				.param("key", key)
				.update();
	}

	/// The ticket a successful request under the key wrote to; a replay answers it as it is now.
	record Replay(String reference) {
	}

	private record Stored(String requestHash, Replay replay) {
	}

}
