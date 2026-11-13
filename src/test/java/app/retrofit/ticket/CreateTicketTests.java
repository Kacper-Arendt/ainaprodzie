package app.retrofit.ticket;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

import app.retrofit.RandomPortContext;

/// `POST /api/tickets` over the real server with real commits: defaults, the CREATED entry, refusals and the
/// `Idempotency-Key` replay, reuse and race rules.
class CreateTicketTests extends RandomPortContext {

	private static final String PROBLEMS = "https://retrofit.app/problems/";

	private static final ParameterizedTypeReference<Map<String, Object>> JSON_OBJECT = new ParameterizedTypeReference<>() {
	};

	TicketFixtures fixtures;

	UUID customer;

	String session;

	@BeforeEach
	void setUp() {
		fixtures = new TicketFixtures(jdbc);
		customer = fixtures.customer(fixtures.organization());
		session = login(customer);
	}

	@Test
	void customerCreatesATicketWithDefaultsAndACreatedEntry() {
		var response = create(session, Map.of("title", "  Export fails  ", "category", "BUG"), null);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		var reference = reference(response);
		assertThat(response.getHeaders().getLocation()).isEqualTo(URI.create("/api/tickets/" + reference));
		assertThat(response.getHeaders().getETag()).isEqualTo("\"0\"");
		assertThat(response.getBody()).containsEntry("version", 0).containsEntry("description", "");
		var stored = jdbc.sql("""
				SELECT title, description, status, priority, category, team_id, assignee_id, version, author_id,
				       created_at, updated_at, first_response_at, closed_at
				FROM ticket WHERE number = :number
				""")
				.param("number", number(reference))
				.query((rs, rowNum) -> {
					assertThat(rs.getString("title")).isEqualTo("Export fails");
					assertThat(rs.getString("description")).isEmpty();
					assertThat(rs.getString("status")).isEqualTo("NEW");
					assertThat(rs.getString("priority")).isEqualTo("NORMAL");
					assertThat(rs.getString("category")).isEqualTo("BUG");
					assertThat(rs.getObject("team_id")).isNull();
					assertThat(rs.getObject("assignee_id")).isNull();
					assertThat(rs.getLong("version")).isZero();
					assertThat(rs.getObject("author_id", UUID.class)).isEqualTo(customer);
					assertThat(rs.getTimestamp("updated_at")).isEqualTo(rs.getTimestamp("created_at"));
					assertThat(rs.getTimestamp("first_response_at")).isNull();
					assertThat(rs.getTimestamp("closed_at")).isNull();
					return rs.getTimestamp("created_at").toInstant();
				})
				.single();
		var audit = jdbc.sql("""
				SELECT a.field, a.old_value, a.new_value, a.actor_id, a.changed_at
				FROM ticket_audit_entry a JOIN ticket t ON t.id = a.ticket_id
				WHERE t.number = :number
				""")
				.param("number", number(reference))
				.query((rs, rowNum) -> new AuditRow(rs.getString("field"), rs.getString("old_value"),
						rs.getString("new_value"), rs.getObject("actor_id", UUID.class),
						rs.getTimestamp("changed_at").toInstant()))
				.list();
		assertThat(audit).containsExactly(new AuditRow("CREATED", null, "Export fails", customer, stored));
	}

	@Test
	void descriptionIsStoredAsSent() {
		var response = create(session, Map.of("title", "Slow", "description", "  Line one\nLine two  "), null);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(response.getBody()).containsEntry("description", "  Line one\nLine two  ");
	}

	@Test
	void supportMayNotCreateTickets() {
		var support = login(fixtures.support(fixtures.team()));

		var response = create(support, Map.of("title", "From support"), null);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/forbidden");
	}

	@Test
	void blankTitleIsRequired() {
		var response = create(session, Map.of("title", "   "), null);

		assertValidation(response, "title", "field.required");
		assertThat(ticketsOf(customer)).isZero();
	}

	@Test
	void missingTitleIsRequired() {
		assertValidation(create(session, Map.of("description", "No title"), null), "title", "field.required");
	}

	@Test
	void titleOverTwoHundredCharactersIsTooLong() {
		assertThat(create(session, Map.of("title", "t".repeat(200)), null).getStatusCode())
				.isEqualTo(HttpStatus.CREATED);
		assertValidation(create(session, Map.of("title", "t".repeat(201)), null), "title", "field.too-long");
	}

	@Test
	void descriptionOverTenThousandCharactersIsTooLong() {
		var response = create(session, Map.of("title", "Long", "description", "d".repeat(10_001)), null);

		assertValidation(response, "description", "field.too-long");
	}

	@Test
	void nulCharacterInTitleOrDescriptionIsInvalid() {
		assertValidation(create(session, Map.of("title", "Nul \u0000 here"), null), "title", "field.invalid");
		assertValidation(create(session, Map.of("title", "Fine", "description", "Nul \u0000 here"), null),
				"description", "field.invalid");
		assertThat(ticketsOf(customer)).isZero();
	}

	@Test
	void unknownCategoryIsRejected() {
		var response = create(session, Map.of("title", "Odd", "category", "PRAISE"), null);

		assertValidation(response, "category", "category.unknown");
	}

	@Test
	void titleThatIsNotAStringIsMalformed() {
		var response = create(session, Map.of("title", Map.of()), null);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "malformed-request");
	}

	@Test
	void idempotencyKeyMustBeOneTo255VisibleAsciiCharacters() {
		for (var key : List.of("", "k".repeat(256), "two words")) {
			var response = create(session, Map.of("title", "Keyed"), key);

			assertValidation(response, "Idempotency-Key", "idempotencyKey.invalid");
		}
		assertThat(create(session, Map.of("title", "Keyed"), "~".repeat(255)).getStatusCode())
				.isEqualTo(HttpStatus.CREATED);
	}

	@Test
	void sameKeyAndRequestReplaysWithTheCurrentVersion() {
		var key = UUID.randomUUID().toString();
		var body = Map.<String, Object>of("title", "Replayed", "description", "Once");
		var first = create(session, body, key);
		jdbc.sql("UPDATE ticket SET version = version + 1 WHERE number = :number")
				.param("number", number(reference(first)))
				.update();

		var replay = create(session, Map.of("description", "Once", "title", " Replayed "), key);

		assertThat(replay.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(replay.getHeaders().getLocation()).isEqualTo(first.getHeaders().getLocation());
		assertThat(replay.getHeaders().getETag()).isEqualTo("\"1\"");
		assertThat(replay.getBody()).containsEntry("version", 1);
		assertThat(ticketsOf(customer)).isOne();
		assertThat(jdbc.sql("""
				SELECT version FROM ticket WHERE number = :number
				""").param("number", number(reference(first))).query(Long.class).single()).isOne();
		assertThat(storedStatus(customer, key)).isEqualTo(201);
	}

	@Test
	void keyReusedWithADifferentRequestIsRefused() {
		var key = UUID.randomUUID().toString();
		create(session, Map.of("title", "First"), key);

		var response = create(session, Map.of("title", "Second"), key);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "idempotency/key-reused");
		assertThat(ticketsOf(customer)).isOne();
	}

	@Test
	void requestHashKeepsFieldBoundaries() {
		var key = UUID.randomUUID().toString();
		create(session, Map.of("title", "a", "description", "b c"), key);

		var response = create(session, Map.of("title", "a b", "description", "c"), key);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "idempotency/key-reused");
	}

	@Test
	void keysAreScopedPerUser() {
		var key = UUID.randomUUID().toString();
		var colleague = fixtures.customer(fixtures.organization());

		var mine = create(session, Map.of("title", "Shared key"), key);
		var theirs = create(login(colleague), Map.of("title", "Shared key"), key);

		assertThat(mine.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(theirs.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(theirs.getHeaders().getLocation()).isNotEqualTo(mine.getHeaders().getLocation());
	}

	@Test
	void retryAfterARefusalIsEvaluatedAfresh() {
		var key = UUID.randomUUID().toString();

		var refused = create(session, Map.of("title", ""), key);

		assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
		assertThat(keyRows(customer, key)).isZero();
		var retried = create(session, Map.of("title", "Fixed"), key);
		assertThat(retried.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(storedStatus(customer, key)).isEqualTo(201);
	}

	@Test
	void parallelDuplicatesCreateOneTicket() throws Exception {
		var key = UUID.randomUUID().toString();
		var csrf = primeCsrf();
		var start = new CountDownLatch(1);
		var duplicates = 6;
		var calls = new ArrayList<Callable<ResponseEntity<Map<String, Object>>>>();
		for (int i = 0; i < duplicates; i++) {
			calls.add(() -> {
				start.await();
				return create(session, csrf, Map.of("title", "Raced"), key);
			});
		}
		var responses = new ArrayList<ResponseEntity<Map<String, Object>>>();
		try (var executor = Executors.newFixedThreadPool(duplicates)) {
			var futures = calls.stream().map(executor::submit).toList();
			start.countDown();
			for (var future : futures) {
				responses.add(future.get(30, TimeUnit.SECONDS));
			}
		}

		assertThat(responses).allSatisfy(response -> assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED));
		assertThat(responses.stream().map(response -> response.getHeaders().getLocation()).distinct()).hasSize(1);
		assertThat(ticketsOf(customer)).isOne();
		assertThat(keyRows(customer, key)).isOne();
	}

	private String login(UUID userId) {
		return login(fixtures.email(userId), TicketFixtures.PASSWORD);
	}

	private ResponseEntity<Map<String, Object>> create(String session, Map<String, ?> body, @Nullable String key) {
		return create(session, primeCsrf(), body, key);
	}

	private ResponseEntity<Map<String, Object>> create(String session, CsrfPair csrf, Map<String, ?> body,
			@Nullable String key) {
		var request = http().post().uri("/api/tickets")
				.header("X-XSRF-TOKEN", csrf.header())
				.header(HttpHeaders.COOKIE, csrf.cookie() + "; SESSION=" + session)
				.contentType(MediaType.APPLICATION_JSON)
				.body(new HashMap<>(body));
		if (key != null) {
			request.header("Idempotency-Key", key);
		}
		return request.retrieve().toEntity(JSON_OBJECT);
	}

	@SuppressWarnings("unchecked")
	private static String reference(ResponseEntity<Map<String, Object>> response) {
		return (String) ((Map<String, Object>) response.getBody().get("summary")).get("reference");
	}

	private static long number(String reference) {
		return Long.parseLong(reference.substring("RET-".length()));
	}

	@SuppressWarnings("unchecked")
	private static void assertValidation(ResponseEntity<Map<String, Object>> response, String field, String code) {
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "validation");
		assertThat((List<Map<String, Object>>) response.getBody().get("errors"))
				.anySatisfy(error -> assertThat(error).containsEntry("field", field).containsEntry("code", code));
	}

	private long ticketsOf(UUID authorId) {
		return jdbc.sql("SELECT count(*) FROM ticket WHERE author_id = :authorId").param("authorId", authorId)
				.query(Long.class).single();
	}

	private long keyRows(UUID userId, String key) {
		return jdbc.sql("SELECT count(*) FROM idempotency_key WHERE user_id = :userId AND key = :key")
				.param("userId", userId).param("key", key).query(Long.class).single();
	}

	private int storedStatus(UUID userId, String key) {
		return jdbc.sql("SELECT response_status FROM idempotency_key WHERE user_id = :userId AND key = :key")
				.param("userId", userId).param("key", key).query(Integer.class).single();
	}

	private record AuditRow(String field, @Nullable String oldValue, @Nullable String newValue, UUID actorId,
			Instant changedAt) {
	}

}
