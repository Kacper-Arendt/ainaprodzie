package app.retrofit.ticket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

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

/// `POST /api/tickets/{reference}/close` over the real server with real commits: who may close, the `If-Match` rules,
/// the stored state and audit entries, and a race between closes based on one version.
class CloseTicketTests extends RandomPortContext {

	private static final String PROBLEMS = "https://retrofit.app/problems/";

	private static final ParameterizedTypeReference<Map<String, Object>> JSON_OBJECT = new ParameterizedTypeReference<>() {
	};

	TicketFixtures fixtures;

	UUID organization;

	UUID author;

	UUID colleague;

	UUID support;

	String authorSession;

	String colleagueSession;

	String supportSession;

	@BeforeEach
	void setUp() {
		fixtures = new TicketFixtures(jdbc);
		organization = fixtures.organization();
		author = fixtures.customer(organization);
		colleague = fixtures.customer(organization);
		support = fixtures.support(fixtures.team());
		authorSession = login(author);
		colleagueSession = login(colleague);
		supportSession = login(support);
	}

	@Test
	void authorWithdrawsAnOpenTicket() {
		var ticket = fixtures.ticket(author).status("IN_PROGRESS").insert();

		var response = close(authorSession, ticket.reference(), "\"0\"", null);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
		assertThat(response.getBody()).containsEntry("version", 1);
		var row = row(ticket.id());
		assertThat(row.status()).isEqualTo("CLOSED");
		assertThat(row.version()).isOne();
		assertThat(row.closedAt()).isNotNull().isEqualTo(row.updatedAt());
		assertThat(row.resolution()).isNull();
		assertThat(audits(ticket.id())).singleElement().isEqualTo(new StoredAudit(author, row.closedAt(), "STATUS",
				"IN_PROGRESS", "CLOSED"));
	}

	@Test
	void authorConfirmsAResolvedTicket() {
		var ticket = fixtures.ticket(author).status("RESOLVED").resolution("Fixed in 2.3").insert();

		var response = close(authorSession, ticket.reference(), "\"0\"", null);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(row(ticket.id()).status()).isEqualTo("CLOSED");
		assertThat(row(ticket.id()).resolution()).isEqualTo("Fixed in 2.3");
	}

	@Test
	void otherCustomerOfTheOrganizationIsForbidden() {
		var ticket = fixtures.ticket(author).status("RESOLVED").resolution("Fixed in 2.3").insert();

		var response = close(colleagueSession, ticket.reference(), "\"0\"", null);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/forbidden");
		assertThat(row(ticket.id()).status()).isEqualTo("RESOLVED");
		assertThat(audits(ticket.id())).isEmpty();
	}

	@Test
	void supportClosesAResolvedTicket() {
		var ticket = fixtures.ticket(author).status("RESOLVED").resolution("Fixed").version(4).insert();

		var response = close(supportSession, ticket.reference(), "\"4\"", Map.of("resolution", "Fixed in 2.3"));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getHeaders().getETag()).isEqualTo("\"5\"");
		var row = row(ticket.id());
		assertThat(row.status()).isEqualTo("CLOSED");
		assertThat(row.resolution()).isEqualTo("Fixed in 2.3");
		assertThat(audits(ticket.id())).containsExactlyInAnyOrder(
				new StoredAudit(support, row.closedAt(), "STATUS", "RESOLVED", "CLOSED"),
				new StoredAudit(support, row.closedAt(), "RESOLUTION", "Fixed", "Fixed in 2.3"));
	}

	@Test
	void supportClosesOnlyAResolvedTicket() {
		for (var status : List.of("NEW", "IN_PROGRESS", "WAITING_FOR_CUSTOMER")) {
			var ticket = fixtures.ticket(author).status(status).insert();

			var response = close(supportSession, ticket.reference(), "\"0\"", Map.of("resolution", "Done"));

			assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
			assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/not-resolved");
			assertThat(row(ticket.id()).status()).isEqualTo(status);
			assertThat(audits(ticket.id())).isEmpty();
		}
	}

	@Test
	void ticketOfAnotherOrganizationIsNotFound() {
		var ticket = fixtures.ticket(fixtures.customer(fixtures.organization())).insert();

		var response = close(authorSession, ticket.reference(), "\"0\"", null);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/not-found");
		assertThat(row(ticket.id()).status()).isEqualTo("NEW");
	}

	@Test
	void missingIfMatchIsRequired() {
		var ticket = fixtures.ticket(author).insert();

		var response = close(authorSession, ticket.reference(), null, null);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.PRECONDITION_REQUIRED);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/precondition-required");
		assertUnchanged(ticket.id(), 0);
	}

	@Test
	void staleIfMatchAnswersWithTheCurrentTag() {
		var ticket = fixtures.ticket(author).version(3).insert();

		var response = close(authorSession, ticket.reference(), "\"2\"", null);

		assertModified(response, "\"3\"");
		assertUnchanged(ticket.id(), 3);
	}

	@Test
	void wildcardAndWeakTagsNeverMatch() {
		var ticket = fixtures.ticket(author).insert();

		assertModified(close(authorSession, ticket.reference(), "*", null), "\"0\"");
		assertModified(close(authorSession, ticket.reference(), "W/\"0\"", null), "\"0\"");
		assertModified(close(authorSession, ticket.reference(), "\"0\", \"1\"", null), "\"0\"");
		assertUnchanged(ticket.id(), 0);
	}

	@Test
	void closingAClosedTicketAgainAnswersItWhateverTheTag() {
		var ticket = fixtures.ticket(author).closedAfter(Duration.ofMinutes(5)).resolution("Fixed").version(2)
				.insert();

		var responses = List.of(close(supportSession, ticket.reference(), "\"2\"", null),
				close(authorSession, ticket.reference(), "\"1\"", null),
				close(authorSession, ticket.reference(), null, Map.of("resolution", "Fixed")),
				close(authorSession, ticket.reference(), "*", Map.of("resolution", " ")));

		for (var response : responses) {
			assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
			assertThat(response.getHeaders().getETag()).isEqualTo("\"2\"");
		}
		assertThat(row(ticket.id()).version()).isEqualTo(2);
		assertThat(audits(ticket.id())).isEmpty();
	}

	@Test
	void anotherResolutionForAClosedTicketIsAlreadyClosedOnlyWithItsCurrentTag() {
		var ticket = fixtures.ticket(author).closedAfter(Duration.ofMinutes(5)).resolution("Fixed").version(2)
				.insert();

		var stale = close(authorSession, ticket.reference(), "\"1\"", Map.of("resolution", "Fixed again"));
		var current = close(authorSession, ticket.reference(), "\"2\"", Map.of("resolution", "Fixed again"));

		assertModified(stale, "\"2\"");
		assertThat(current.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
		assertThat(current.getBody()).containsEntry("type", PROBLEMS + "ticket/already-closed");
		assertThat(row(ticket.id()).version()).isEqualTo(2);
		assertThat(row(ticket.id()).resolution()).isEqualTo("Fixed");
		assertThat(audits(ticket.id())).isEmpty();
	}

	@Test
	void retryAfterASuccessfulCloseAnswersTheClosedTicket() {
		var ticket = fixtures.ticket(author).insert();

		var first = close(authorSession, ticket.reference(), "\"0\"", null);
		var retry = close(authorSession, ticket.reference(), "\"0\"", null);

		for (var response : List.of(first, retry)) {
			assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
			assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
		}
		assertThat(audits(ticket.id())).extracting(StoredAudit::field).containsExactly("STATUS");
	}

	@Test
	void otherCustomerIsForbiddenFromAClosedTicketToo() {
		var ticket = fixtures.ticket(author).closedAfter(Duration.ofMinutes(5)).insert();

		var response = close(colleagueSession, ticket.reference(), null, null);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
	}

	@Test
	void closeAfterANewerCommentIsStale() {
		var ticket = fixtures.ticket(author).insert();
		var commented = http().post().uri("/api/tickets/{reference}/comments", ticket.reference())
				.headers(headers -> authenticate(headers, supportSession, primeCsrf()))
				.contentType(MediaType.APPLICATION_JSON)
				.body(Map.of("body", "Have you tried turning it off and on?"))
				.retrieve()
				.toEntity(JSON_OBJECT);
		assertThat(commented.getStatusCode()).isEqualTo(HttpStatus.CREATED);

		var response = close(authorSession, ticket.reference(), "\"0\"", null);

		assertModified(response, "\"1\"");
		assertThat(row(ticket.id()).status()).isEqualTo("IN_PROGRESS");
	}

	@Test
	void differingResolutionIsAuditedFromTheStoredOne() {
		var ticket = fixtures.ticket(author).resolution("Workaround given").insert();

		var response = close(authorSession, ticket.reference(), "\"0\"", Map.of("resolution", "Fixed for good"));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(row(ticket.id()).resolution()).isEqualTo("Fixed for good");
		assertThat(audits(ticket.id())).extracting(StoredAudit::field, StoredAudit::oldValue, StoredAudit::newValue)
				.containsExactlyInAnyOrder(tuple("STATUS", "NEW", "CLOSED"),
						tuple("RESOLUTION", "Workaround given", "Fixed for good"));
	}

	@Test
	void equalOrBlankResolutionKeepsTheStoredOneUnaudited() {
		var equal = fixtures.ticket(author).resolution("Workaround given").insert();
		var blank = fixtures.ticket(author).resolution("Workaround given").insert();

		assertThat(close(authorSession, equal.reference(), "\"0\"", Map.of("resolution", "Workaround given"))
				.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(close(authorSession, blank.reference(), "\"0\"", Map.of("resolution", "  \n "))
				.getStatusCode()).isEqualTo(HttpStatus.OK);

		for (var ticket : List.of(equal, blank)) {
			assertThat(row(ticket.id()).resolution()).isEqualTo("Workaround given");
			assertThat(audits(ticket.id())).extracting(StoredAudit::field).containsExactly("STATUS");
		}
	}

	@Test
	void parallelClosesOnOneVersionWriteOnce() throws Exception {
		var ticket = fixtures.ticket(author).status("RESOLVED").resolution("Fixed").insert();
		var csrf = primeCsrf();
		var start = new CountDownLatch(1);
		var closers = 6;
		var calls = new ArrayList<Callable<ResponseEntity<Map<String, Object>>>>();
		for (int i = 0; i < closers; i++) {
			var session = i % 2 == 0 ? supportSession : authorSession;
			calls.add(() -> {
				start.await();
				return close(session, csrf, ticket.reference(), "\"0\"", null);
			});
		}
		var responses = new ArrayList<ResponseEntity<Map<String, Object>>>();
		try (var executor = Executors.newFixedThreadPool(closers)) {
			var futures = calls.stream().map(executor::submit).toList();
			start.countDown();
			for (var future : futures) {
				responses.add(future.get(30, TimeUnit.SECONDS));
			}
		}

		assertThat(responses).allSatisfy(response -> {
			assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
			assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
		});
		assertThat(row(ticket.id()).version()).isOne();
		assertThat(audits(ticket.id())).hasSize(1);
	}

	@Test
	void closeWithoutABody() {
		var ticket = fixtures.ticket(author).insert();

		var response = http().post().uri("/api/tickets/{reference}/close", ticket.reference())
				.headers(headers -> authenticate(headers, authorSession, primeCsrf()))
				.header(HttpHeaders.IF_MATCH, "\"0\"")
				.retrieve()
				.toEntity(JSON_OBJECT);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
		assertThat(row(ticket.id()).status()).isEqualTo("CLOSED");
	}

	@Test
	@SuppressWarnings("unchecked")
	void resolutionOverTwoThousandCharactersIsTooLong() {
		var ticket = fixtures.ticket(author).insert();

		var response = close(authorSession, ticket.reference(), "\"0\"", Map.of("resolution", "r".repeat(2_001)));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "validation");
		assertThat((List<Map<String, Object>>) response.getBody().get("errors")).anySatisfy(error -> assertThat(error)
				.containsEntry("field", "resolution").containsEntry("code", "field.too-long"));
		assertUnchanged(ticket.id(), 0);
		assertThat(close(authorSession, ticket.reference(), "\"0\"", Map.of("resolution", "r".repeat(2_000)))
				.getStatusCode()).isEqualTo(HttpStatus.OK);
	}

	@Test
	@SuppressWarnings("unchecked")
	void nulCharacterInResolutionIsInvalid() {
		var ticket = fixtures.ticket(author).insert();

		var response = close(authorSession, ticket.reference(), "\"0\"", Map.of("resolution", "Nul \u0000 here"));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
		assertThat((List<Map<String, Object>>) response.getBody().get("errors")).anySatisfy(error -> assertThat(error)
				.containsEntry("field", "resolution").containsEntry("code", "field.invalid"));
		assertUnchanged(ticket.id(), 0);
	}

	private String login(UUID userId) {
		return login(fixtures.email(userId), TicketFixtures.PASSWORD);
	}

	private ResponseEntity<Map<String, Object>> close(String session, String reference, @Nullable String ifMatch,
			@Nullable Map<String, ?> body) {
		return close(session, primeCsrf(), reference, ifMatch, body);
	}

	private ResponseEntity<Map<String, Object>> close(String session, CsrfPair csrf, String reference,
			@Nullable String ifMatch, @Nullable Map<String, ?> body) {
		var request = http().post().uri("/api/tickets/{reference}/close", reference)
				.headers(headers -> authenticate(headers, session, csrf))
				.contentType(MediaType.APPLICATION_JSON)
				.body(body == null ? Map.of() : new HashMap<>(body));
		if (ifMatch != null) {
			request.header(HttpHeaders.IF_MATCH, ifMatch);
		}
		return request.retrieve().toEntity(JSON_OBJECT);
	}

	private static void authenticate(HttpHeaders headers, String session, CsrfPair csrf) {
		headers.set("X-XSRF-TOKEN", csrf.header());
		headers.set(HttpHeaders.COOKIE, csrf.cookie() + "; SESSION=" + session);
	}

	private static void assertModified(ResponseEntity<Map<String, Object>> response, String currentTag) {
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.PRECONDITION_FAILED);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/modified");
		assertThat(response.getHeaders().getETag()).isEqualTo(currentTag);
	}

	private void assertUnchanged(UUID ticketId, long version) {
		var row = row(ticketId);
		assertThat(row.status()).isNotEqualTo("CLOSED");
		assertThat(row.version()).isEqualTo(version);
		assertThat(audits(ticketId)).isEmpty();
	}

	private TicketRow row(UUID ticketId) {
		return jdbc.sql("SELECT status, version, updated_at, closed_at, resolution FROM ticket WHERE id = :id")
				.param("id", ticketId)
				.query((rs, rowNum) -> new TicketRow(rs.getString("status"), rs.getLong("version"),
						rs.getTimestamp("updated_at").toInstant(),
						rs.getTimestamp("closed_at") == null ? null : rs.getTimestamp("closed_at").toInstant(),
						rs.getString("resolution")))
				.single();
	}

	private List<StoredAudit> audits(UUID ticketId) {
		return jdbc.sql("""
				SELECT actor_id, changed_at, field, old_value, new_value FROM ticket_audit_entry
				WHERE ticket_id = :ticketId
				""")
				.param("ticketId", ticketId)
				.query((rs, rowNum) -> new StoredAudit(rs.getObject("actor_id", UUID.class),
						rs.getTimestamp("changed_at").toInstant(), rs.getString("field"), rs.getString("old_value"),
						rs.getString("new_value")))
				.list();
	}

	private record TicketRow(String status, long version, Instant updatedAt, @Nullable Instant closedAt,
			@Nullable String resolution) {
	}

	private record StoredAudit(UUID actorId, @Nullable Instant changedAt, String field, @Nullable String oldValue,
			@Nullable String newValue) {
	}

}
