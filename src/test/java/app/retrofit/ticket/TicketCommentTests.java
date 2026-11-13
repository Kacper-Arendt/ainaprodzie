package app.retrofit.ticket;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
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

/// `POST /api/tickets/{reference}/comments` over the real server with real commits: the version, `updated_at` and
/// `first_response_at` rules, who may comment where, and the `Idempotency-Key` replay and reuse rules.
class TicketCommentTests extends RandomPortContext {

	private static final String PROBLEMS = "https://retrofit.app/problems/";

	private static final ParameterizedTypeReference<Map<String, Object>> JSON_OBJECT = new ParameterizedTypeReference<>() {
	};

	TicketFixtures fixtures;

	UUID organization;

	UUID customer;

	UUID support;

	String customerSession;

	String supportSession;

	@BeforeEach
	void setUp() {
		fixtures = new TicketFixtures(jdbc);
		organization = fixtures.organization();
		customer = fixtures.customer(organization);
		support = fixtures.support(fixtures.team());
		customerSession = login(customer);
		supportSession = login(support);
	}

	@Test
	void customerCommentBumpsTheVersionAndUpdatedAt() {
		var ticket = fixtures.ticket(customer).insert();

		var response = comment(customerSession, ticket.reference(), Map.of("body", "  Still broken\n"), null);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
		assertThat(response.getHeaders().getLocation()).isNull();
		assertThat(response.getBody()).containsEntry("version", 1);
		var comments = comments(ticket.id());
		assertThat(comments).singleElement().satisfies(stored -> {
			assertThat(stored.body()).isEqualTo("  Still broken\n");
			assertThat(stored.internal()).isFalse();
			assertThat(stored.authorId()).isEqualTo(customer);
		});
		var row = row(ticket.id());
		assertThat(row.version()).isOne();
		assertThat(row.updatedAt()).isEqualTo(comments.getFirst().createdAt());
		assertThat(row.firstResponseAt()).isNull();
		assertThat(auditRows(ticket.id())).isZero();
	}

	@Test
	void firstSupportPublicReplySetsFirstResponseOnce() {
		var ticket = fixtures.ticket(customer).insert();

		assertThat(comment(supportSession, ticket.reference(), Map.of("body", "Looking", "internal", true), null)
				.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(row(ticket.id()).firstResponseAt()).isNull();
		comment(supportSession, ticket.reference(), Map.of("body", "First reply"), null);
		var firstReply = comments(ticket.id()).getLast().createdAt();
		var second = comment(supportSession, ticket.reference(), Map.of("body", "Second reply", "internal", false),
				null);

		assertThat(second.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(second.getHeaders().getETag()).isEqualTo("\"3\"");
		var row = row(ticket.id());
		assertThat(row.firstResponseAt()).isEqualTo(firstReply);
		assertThat(row.updatedAt()).isEqualTo(comments(ticket.id()).getLast().createdAt());
		assertThat(row.version()).isEqualTo(3);
	}

	@Test
	void firstSupportPublicReplyTakesUpANewTicket() {
		var ticket = fixtures.ticket(customer).insert();

		comment(supportSession, ticket.reference(), Map.of("body", "Looking", "internal", true), null);
		assertThat(status(ticket.id())).isEqualTo("NEW");
		comment(supportSession, ticket.reference(), Map.of("body", "First reply"), null);

		assertThat(status(ticket.id())).isEqualTo("IN_PROGRESS");
		assertThat(statusAudits(ticket.id())).containsExactly(
				new StatusAudit(support, comments(ticket.id()).getLast().createdAt(), "NEW", "IN_PROGRESS"));
	}

	@Test
	void customerCommentHandsAWaitingOrResolvedTicketBackToSupport() {
		for (var waiting : List.of("WAITING_FOR_CUSTOMER", "RESOLVED")) {
			var ticket = fixtures.ticket(customer).status(waiting).insert();

			var response = comment(customerSession, ticket.reference(), Map.of("body", "Here you go"), null);

			assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
			assertThat(row(ticket.id()).version()).isOne();
			assertThat(status(ticket.id())).isEqualTo("IN_PROGRESS");
			assertThat(statusAudits(ticket.id())).containsExactly(
					new StatusAudit(customer, comments(ticket.id()).getLast().createdAt(), waiting, "IN_PROGRESS"));
		}
	}

	@Test
	void otherCommentsKeepTheStatus() {
		var fromCustomer = List.of("NEW", "IN_PROGRESS");
		var fromSupport = List.of("IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED");
		for (var status : fromCustomer) {
			var ticket = fixtures.ticket(customer).status(status).insert();
			comment(customerSession, ticket.reference(), Map.of("body", "Any news?"), null);
			assertThat(status(ticket.id())).isEqualTo(status);
			assertThat(auditRows(ticket.id())).isZero();
		}
		for (var status : fromSupport) {
			var ticket = fixtures.ticket(customer).status(status).insert();
			comment(supportSession, ticket.reference(), Map.of("body", "Still on it"), null);
			assertThat(status(ticket.id())).isEqualTo(status);
			assertThat(auditRows(ticket.id())).isZero();
		}
	}

	@Test
	void customerMayNotAddAnInternalNote() {
		var ticket = fixtures.ticket(customer).insert();

		var response = comment(customerSession, ticket.reference(), Map.of("body", "Secret", "internal", true), null);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/forbidden");
		assertThat(comments(ticket.id())).isEmpty();
		assertThat(row(ticket.id()).version()).isZero();
	}

	@Test
	void ticketOfAnotherOrganizationIsNotFound() {
		var stranger = fixtures.customer(fixtures.organization());
		var ticket = fixtures.ticket(stranger).insert();

		var response = comment(customerSession, ticket.reference(), Map.of("body", "Hello"), null);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/not-found");
		assertThat(comments(ticket.id())).isEmpty();
	}

	@Test
	void customerNoteOnAnotherOrganizationsTicketIsNotFoundRatherThanForbidden() {
		var ticket = fixtures.ticket(fixtures.customer(fixtures.organization())).insert();

		var response = comment(customerSession, ticket.reference(), Map.of("body", "Secret", "internal", true), null);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/not-found");
		assertThat(comments(ticket.id())).isEmpty();
	}

	@Test
	void customerMayNotCommentOnAClosedTicket() {
		var ticket = fixtures.ticket(customer).closedAfter(Duration.ofMinutes(5)).insert();

		var response = comment(customerSession, ticket.reference(), Map.of("body", "Reopen please"), null);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/closed");
		assertThat(comments(ticket.id())).isEmpty();
		assertThat(row(ticket.id()).version()).isZero();
	}

	@Test
	void supportMayCommentAndAddNotesOnAClosedTicket() {
		var ticket = fixtures.ticket(customer).closedAfter(Duration.ofMinutes(5)).insert();

		var publicReply = comment(supportSession, ticket.reference(), Map.of("body", "For the record"), null);
		var note = comment(supportSession, ticket.reference(), Map.of("body", "Root cause", "internal", true), null);

		assertThat(publicReply.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(note.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(note.getHeaders().getETag()).isEqualTo("\"2\"");
		assertThat(comments(ticket.id())).extracting(StoredComment::internal).containsExactly(false, true);
	}

	/// A ticket closed without a first response keeps the waiting time and SLA it closed with (ADR 0004).
	@Test
	void supportReplyOnAClosedTicketIsNoFirstResponse() {
		var ticket = fixtures.ticket(customer).closedAfter(Duration.ofMinutes(5)).insert();

		var response = comment(supportSession, ticket.reference(), Map.of("body", "For the record"), null);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(row(ticket.id()).firstResponseAt()).isNull();
	}

	@Test
	void parallelSupportFirstRepliesKeepTheEarliestAndLoseNoBump() throws Exception {
		var ticket = fixtures.ticket(customer).insert();
		var colleague = login(fixtures.support(fixtures.team()));
		var csrf = primeCsrf();
		var start = new CountDownLatch(1);
		var replies = 6;
		var calls = new ArrayList<Callable<ResponseEntity<Map<String, Object>>>>();
		for (int i = 0; i < replies; i++) {
			var session = i % 2 == 0 ? supportSession : colleague;
			var body = "Reply " + i;
			calls.add(() -> {
				start.await();
				return comment(session, csrf, ticket.reference(), Map.of("body", body), null);
			});
		}
		var responses = new ArrayList<ResponseEntity<Map<String, Object>>>();
		try (var executor = Executors.newFixedThreadPool(replies)) {
			var futures = calls.stream().map(executor::submit).toList();
			start.countDown();
			for (var future : futures) {
				responses.add(future.get(30, TimeUnit.SECONDS));
			}
		}

		assertThat(responses).allSatisfy(response -> assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED));
		var comments = comments(ticket.id());
		assertThat(comments).hasSize(replies);
		var row = row(ticket.id());
		assertThat(row.version()).isEqualTo(replies);
		assertThat(row.firstResponseAt()).isEqualTo(comments.stream().map(StoredComment::createdAt).min(Instant::compareTo)
				.orElseThrow());
		assertThat(row.updatedAt()).isEqualTo(comments.stream().map(StoredComment::createdAt).max(Instant::compareTo)
				.orElseThrow());
	}

	@Test
	void sameKeyAndRequestReplaysWithTheCurrentTicket() {
		var ticket = fixtures.ticket(customer).insert();
		var key = UUID.randomUUID().toString();
		comment(customerSession, ticket.reference(), Map.of("body", "Once"), key);
		comment(supportSession, ticket.reference(), Map.of("body", "Answer"), null);

		var replay = comment(customerSession, ticket.reference().toLowerCase(),
				Map.of("body", "Once", "internal", false), key);

		assertThat(replay.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(replay.getHeaders().getETag()).isEqualTo("\"2\"");
		assertThat(comments(ticket.id())).extracting(StoredComment::body).containsExactly("Once", "Answer");
		assertThat(row(ticket.id()).version()).isEqualTo(2);
		assertThat(storedStatus(customer, key)).isEqualTo(201);
	}

	@Test
	void parallelDuplicatesWithOneKeyAddOneComment() throws Exception {
		var ticket = fixtures.ticket(customer).insert();
		var key = UUID.randomUUID().toString();
		var csrf = primeCsrf();
		var start = new CountDownLatch(1);
		var duplicates = 6;
		var calls = new ArrayList<Callable<ResponseEntity<Map<String, Object>>>>();
		for (int i = 0; i < duplicates; i++) {
			calls.add(() -> {
				start.await();
				return comment(customerSession, csrf, ticket.reference(), Map.of("body", "Only once"), key);
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

		assertThat(responses).allSatisfy(response -> {
			assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
			assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
		});
		assertThat(comments(ticket.id())).singleElement().extracting(StoredComment::body).isEqualTo("Only once");
		assertThat(row(ticket.id()).version()).isOne();
		assertThat(storedStatus(customer, key)).isEqualTo(201);
	}

	@Test
	void malformedIdempotencyKeyIsRefused() {
		var ticket = fixtures.ticket(customer).insert();

		assertValidation(comment(customerSession, ticket.reference(), Map.of("body", "Keyed"), "two words"),
				"Idempotency-Key", "idempotencyKey.invalid");
		assertThat(comments(ticket.id())).isEmpty();
		assertThat(row(ticket.id()).version()).isZero();
	}

	@Test
	void sameKeyOnAnotherTicketIsRefused() {
		var first = fixtures.ticket(customer).insert();
		var second = fixtures.ticket(customer).insert();
		var key = UUID.randomUUID().toString();
		comment(customerSession, first.reference(), Map.of("body", "Same words"), key);

		var response = comment(customerSession, second.reference(), Map.of("body", "Same words"), key);

		assertKeyReused(response);
		assertThat(comments(second.id())).isEmpty();
		assertThat(row(second.id()).version()).isZero();
	}

	@Test
	void keyUsedBeforeForCreateIsRefused() {
		var ticket = fixtures.ticket(customer).insert();
		var key = UUID.randomUUID().toString();
		var created = http().post().uri("/api/tickets")
				.headers(headers -> authenticate(headers, customerSession, primeCsrf()))
				.header("Idempotency-Key", key)
				.contentType(MediaType.APPLICATION_JSON)
				.body(Map.of("title", "Keyed"))
				.retrieve()
				.toEntity(JSON_OBJECT);
		assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);

		var response = comment(customerSession, ticket.reference(), Map.of("body", "Keyed"), key);

		assertKeyReused(response);
		assertThat(comments(ticket.id())).isEmpty();
	}

	@Test
	void commentReplayedAfterTheTicketClosedSucceeds() {
		var ticket = fixtures.ticket(customer).insert();
		var key = UUID.randomUUID().toString();
		comment(customerSession, ticket.reference(), Map.of("body", "Before closing"), key);
		jdbc.sql("UPDATE ticket SET status = 'CLOSED', closed_at = now(), version = version + 1 WHERE id = :id")
				.param("id", ticket.id())
				.update();

		var replay = comment(customerSession, ticket.reference(), Map.of("body", "Before closing"), key);

		assertThat(replay.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(replay.getHeaders().getETag()).isEqualTo("\"2\"");
		assertThat(comments(ticket.id())).hasSize(1);
	}

	@Test
	void retryAfterAConflictIsEvaluatedAfresh() {
		var ticket = fixtures.ticket(customer).closedAfter(Duration.ofMinutes(5)).insert();
		var key = UUID.randomUUID().toString();

		var refused = comment(customerSession, ticket.reference(), Map.of("body", "Hello?"), key);

		assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
		assertThat(keyRows(customer, key)).isZero();
		jdbc.sql("UPDATE ticket SET status = 'IN_PROGRESS', closed_at = NULL WHERE id = :id")
				.param("id", ticket.id())
				.update();
		var retried = comment(customerSession, ticket.reference(), Map.of("body", "Hello?"), key);
		assertThat(retried.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(storedStatus(customer, key)).isEqualTo(201);
		assertThat(comments(ticket.id())).hasSize(1);
	}

	@Test
	void bodyIsRequired() {
		var ticket = fixtures.ticket(customer).insert();

		assertValidation(comment(customerSession, ticket.reference(), Map.of("body", " \n "), null), "body",
				"field.required");
		assertValidation(comment(customerSession, ticket.reference(), Map.of("internal", false), null), "body",
				"field.required");
		assertThat(comments(ticket.id())).isEmpty();
	}

	@Test
	void bodyOverTenThousandCharactersIsTooLong() {
		var ticket = fixtures.ticket(customer).insert();

		assertValidation(comment(customerSession, ticket.reference(), Map.of("body", "b".repeat(10_001)), null), "body",
				"field.too-long");
		assertThat(comment(customerSession, ticket.reference(), Map.of("body", "b".repeat(10_000)), null)
				.getStatusCode()).isEqualTo(HttpStatus.CREATED);
	}

	@Test
	void nulCharacterInBodyIsInvalid() {
		var ticket = fixtures.ticket(customer).insert();

		assertValidation(comment(customerSession, ticket.reference(), Map.of("body", "Nul \u0000 here"), null), "body",
				"field.invalid");
		assertThat(comments(ticket.id())).isEmpty();
	}

	private String login(UUID userId) {
		return login(fixtures.email(userId), TicketFixtures.PASSWORD);
	}

	private ResponseEntity<Map<String, Object>> comment(String session, String reference, Map<String, ?> body,
			@Nullable String key) {
		return comment(session, primeCsrf(), reference, body, key);
	}

	private ResponseEntity<Map<String, Object>> comment(String session, CsrfPair csrf, String reference,
			Map<String, ?> body, @Nullable String key) {
		var request = http().post().uri("/api/tickets/{reference}/comments", reference)
				.headers(headers -> authenticate(headers, session, csrf))
				.contentType(MediaType.APPLICATION_JSON)
				.body(new HashMap<>(body));
		if (key != null) {
			request.header("Idempotency-Key", key);
		}
		return request.retrieve().toEntity(JSON_OBJECT);
	}

	private static void authenticate(HttpHeaders headers, String session, CsrfPair csrf) {
		headers.set("X-XSRF-TOKEN", csrf.header());
		headers.set(HttpHeaders.COOKIE, csrf.cookie() + "; SESSION=" + session);
	}

	private static void assertKeyReused(ResponseEntity<Map<String, Object>> response) {
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "idempotency/key-reused");
	}

	@SuppressWarnings("unchecked")
	private static void assertValidation(ResponseEntity<Map<String, Object>> response, String field, String code) {
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "validation");
		assertThat((List<Map<String, Object>>) response.getBody().get("errors"))
				.anySatisfy(error -> assertThat(error).containsEntry("field", field).containsEntry("code", code));
	}

	private List<StoredComment> comments(UUID ticketId) {
		return jdbc.sql("""
				SELECT author_id, internal, body, created_at FROM ticket_comment
				WHERE ticket_id = :ticketId ORDER BY created_at, id
				""")
				.param("ticketId", ticketId)
				.query((rs, rowNum) -> new StoredComment(rs.getObject("author_id", UUID.class),
						rs.getBoolean("internal"), rs.getString("body"), rs.getTimestamp("created_at").toInstant()))
				.list();
	}

	private TicketRow row(UUID ticketId) {
		return jdbc.sql("SELECT version, updated_at, first_response_at FROM ticket WHERE id = :id")
				.param("id", ticketId)
				.query((rs, rowNum) -> new TicketRow(rs.getLong("version"), rs.getTimestamp("updated_at").toInstant(),
						rs.getTimestamp("first_response_at") == null ? null
								: rs.getTimestamp("first_response_at").toInstant()))
				.single();
	}

	private String status(UUID ticketId) {
		return jdbc.sql("SELECT status FROM ticket WHERE id = :id").param("id", ticketId).query(String.class).single();
	}

	private List<StatusAudit> statusAudits(UUID ticketId) {
		return jdbc.sql("""
				SELECT actor_id, changed_at, old_value, new_value FROM ticket_audit_entry
				WHERE ticket_id = :ticketId AND field = 'STATUS'
				""")
				.param("ticketId", ticketId)
				.query((rs, rowNum) -> new StatusAudit(rs.getObject("actor_id", UUID.class),
						rs.getTimestamp("changed_at").toInstant(), rs.getString("old_value"), rs.getString("new_value")))
				.list();
	}

	private long auditRows(UUID ticketId) {
		return jdbc.sql("SELECT count(*) FROM ticket_audit_entry WHERE ticket_id = :ticketId")
				.param("ticketId", ticketId).query(Long.class).single();
	}

	private long keyRows(UUID userId, String key) {
		return jdbc.sql("SELECT count(*) FROM idempotency_key WHERE user_id = :userId AND key = :key")
				.param("userId", userId).param("key", key).query(Long.class).single();
	}

	private int storedStatus(UUID userId, String key) {
		return jdbc.sql("SELECT response_status FROM idempotency_key WHERE user_id = :userId AND key = :key")
				.param("userId", userId).param("key", key).query(Integer.class).single();
	}

	private record StoredComment(UUID authorId, boolean internal, String body, Instant createdAt) {
	}

	private record TicketRow(long version, Instant updatedAt, @Nullable Instant firstResponseAt) {
	}

	private record StatusAudit(UUID actorId, Instant changedAt, String oldValue, String newValue) {
	}

}
