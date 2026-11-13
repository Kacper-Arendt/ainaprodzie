package app.retrofit.ticket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
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

/// Editing a ticket's title and description through `PATCH /api/tickets/{reference}` over the real server: who may
/// edit in which status, the validation shared with raising a ticket, a body that mixes content with other fields,
/// the `If-Match` rules and one audit entry per changed field.
class EditTicketTests extends RandomPortContext {

	private static final String PROBLEMS = "https://retrofit.app/problems/";

	private static final ParameterizedTypeReference<Map<String, Object>> JSON_OBJECT = new ParameterizedTypeReference<>() {
	};

	TicketFixtures fixtures;

	UUID organization;

	UUID author;

	UUID support;

	String authorSession;

	String supportSession;

	@BeforeEach
	void setUp() {
		fixtures = new TicketFixtures(jdbc);
		organization = fixtures.organization();
		author = fixtures.customer(organization);
		support = fixtures.support(fixtures.team());
		authorSession = login(author);
		supportSession = login(support);
	}

	@Test
	void authorEditsANewTicketAndEveryChangedFieldIsAudited() {
		var ticket = fixtures.ticket(author).title("Export fails").description("CSV export breaks.")
				.updatedAgo(Duration.ofMinutes(30)).insert();

		var response = patch(authorSession, ticket.reference(), "\"0\"",
				"{\"title\": \"  CSV export fails on large boards  \", \"description\": \"Boards over 500 tasks.\"}");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
		assertThat(response.getBody()).containsEntry("description", "Boards over 500 tasks.");
		var row = row(ticket.id());
		assertThat(row).isEqualTo(new TicketRow("CSV export fails on large boards", "Boards over 500 tasks.", 1,
				row.updatedAt()));
		assertThat(row.updatedAt()).isAfter(Instant.now().minus(Duration.ofMinutes(1)));
		assertThat(audits(ticket.id())).containsExactlyInAnyOrder(
				new StoredAudit(author, row.updatedAt(), "TITLE", "Export fails", "CSV export fails on large boards"),
				new StoredAudit(author, row.updatedAt(), "DESCRIPTION", "CSV export breaks.",
						"Boards over 500 tasks."));
	}

	@Test
	void anotherCustomerOfTheOrganizationIsForbidden() {
		var ticket = fixtures.ticket(author).insert();
		var colleague = login(fixtures.customer(organization));

		var response = patch(colleague, ticket.reference(), "\"0\"", "{\"title\": \"Mine now\"}");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/forbidden");
		assertUnchanged(ticket.id(), 0);
	}

	@Test
	void customerOfAnotherOrganizationGetsNotFound() {
		var ticket = fixtures.ticket(fixtures.customer(fixtures.organization())).insert();

		var response = patch(authorSession, ticket.reference(), "\"0\"", "{\"title\": \"Mine now\"}");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/not-found");
		assertUnchanged(ticket.id(), 0);
	}

	@Test
	void authorCannotEditOnceSupportIsWorkingOnTheTicket() {
		var ticket = fixtures.ticket(author).status("IN_PROGRESS").insert();

		var response = patch(authorSession, ticket.reference(), "\"0\"", "{\"title\": \"Clearer title\"}");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/not-editable")
				.containsEntry("detail",
						"Support is already working on ticket " + ticket.reference() + ". Add a comment instead.");
		assertUnchanged(ticket.id(), 0);
	}

	@Test
	void contentIsValidatedAsWhenRaisingATicket() {
		var ticket = fixtures.ticket(author).insert();

		assertValidation(patch(authorSession, ticket.reference(), "\"0\"", "{\"title\": \"   \"}"), "title",
				"field.required");
		assertValidation(patch(authorSession, ticket.reference(), "\"0\"", "{\"title\": null}"), "title",
				"field.required");
		assertValidation(patch(authorSession, ticket.reference(), "\"0\"",
				"{\"title\": \"%s\"}".formatted("t".repeat(201))), "title", "field.too-long");
		assertValidation(patch(authorSession, ticket.reference(), "\"0\"", "{\"title\": \"Nul \\u0000 here\"}"),
				"title", "field.invalid");
		assertValidation(patch(authorSession, ticket.reference(), "\"0\"", "{\"description\": null}"),
				"description", "field.required");
		assertValidation(patch(authorSession, ticket.reference(), "\"0\"",
				"{\"description\": \"%s\"}".formatted("d".repeat(10_001))), "description", "field.too-long");
		assertValidation(patch(authorSession, ticket.reference(), "\"0\"",
				"{\"description\": \"Nul \\u0000 here\"}"), "description", "field.invalid");
		assertUnchanged(ticket.id(), 0);
	}

	@SuppressWarnings("unchecked")
	@Test
	void contentMixedWithOtherFieldsIsRefusedOnEachContentFieldBeforeTheTicketIsLookedUp() {
		var ticket = fixtures.ticket(author).insert();
		var hidden = fixtures.ticket(fixtures.customer(fixtures.organization())).insert();

		var mixed = patch(supportSession, ticket.reference(), "\"0\"",
				"{\"title\": \"Clearer title\", \"description\": \"More detail\", \"priority\": \"HIGH\"}");
		var mixedOnHidden = patch(authorSession, hidden.reference(), "\"0\"",
				"{\"description\": \"More detail\", \"teamId\": null}");

		assertThat((List<Map<String, Object>>) mixed.getBody().get("errors"))
				.extracting(error -> error.get("field"), error -> error.get("code"))
				.containsExactlyInAnyOrder(tuple("title", "field.not-combinable"),
						tuple("description", "field.not-combinable"));
		assertValidation(mixed, "title", "field.not-combinable");
		assertValidation(mixedOnHidden, "description", "field.not-combinable");
		assertUnchanged(ticket.id(), 0);
		assertUnchanged(hidden.id(), 0);
	}

	@Test
	void contentThatIsNotAStringIsMalformed() {
		var ticket = fixtures.ticket(author).insert();

		for (var body : List.of("{\"title\": 5}", "{\"description\": [\"text\"]}")) {
			var response = patch(authorSession, ticket.reference(), "\"0\"", body);

			assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
			assertThat(response.getBody()).containsEntry("type", PROBLEMS + "malformed-request");
		}
		assertUnchanged(ticket.id(), 0);
	}

	@Test
	void limitsCountCharactersAndTheDescriptionMayBeEmptied() {
		var ticket = fixtures.ticket(author).insert();

		var response = patch(authorSession, ticket.reference(), "\"0\"",
				"{\"title\": \"%s\", \"description\": \"\"}".formatted("😀".repeat(200)));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(row(ticket.id()).description()).isEmpty();
	}

	@Test
	void editThatChangesNothingAnswersTheTicketWhateverTheTagAndStatus() {
		var started = fixtures.ticket(author).title("Export fails").status("IN_PROGRESS").version(3)
				.updatedAgo(Duration.ofMinutes(30)).insert();
		var closed = fixtures.ticket(author).title("Export fails").closedAfter(Duration.ofMinutes(5)).version(3)
				.insert();
		var before = row(started.id());

		for (var ticket : List.of(started, closed)) {
			for (var ifMatch : Arrays.asList("\"2\"", "*", null)) {
				var response = patch(authorSession, ticket.reference(), ifMatch,
						"{\"title\": \" Export fails \", \"description\": \"Something does not work.\"}");

				assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
				assertThat(response.getHeaders().getETag()).isEqualTo("\"3\"");
			}
			assertUnchanged(ticket.id(), 3);
		}
		assertThat(row(started.id())).isEqualTo(before);
	}

	@Test
	void retryAfterASuccessfulEditAnswersTheTicketWithoutAnotherAudit() {
		var ticket = fixtures.ticket(author).insert();

		var first = patch(supportSession, ticket.reference(), "\"0\"", "{\"title\": \"Clearer title\"}");
		var retry = patch(supportSession, ticket.reference(), "\"0\"", "{\"title\": \"Clearer title\"}");

		for (var response : List.of(first, retry)) {
			assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
			assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
		}
		assertThat(audits(ticket.id())).extracting(StoredAudit::field).containsExactly("TITLE");
	}

	@Test
	void missingIfMatchIsRequiredAndAStaleOneAnswersTheCurrentTag() {
		var ticket = fixtures.ticket(author).version(3).insert();

		var missing = patch(supportSession, ticket.reference(), null, "{\"title\": \"Clearer title\"}");
		var stale = patch(supportSession, ticket.reference(), "\"2\"", "{\"title\": \"Clearer title\"}");

		assertThat(missing.getStatusCode()).isEqualTo(HttpStatus.PRECONDITION_REQUIRED);
		assertThat(missing.getBody()).containsEntry("type", PROBLEMS + "ticket/precondition-required");
		assertThat(stale.getStatusCode()).isEqualTo(HttpStatus.PRECONDITION_FAILED);
		assertThat(stale.getBody()).containsEntry("type", PROBLEMS + "ticket/modified");
		assertThat(stale.getHeaders().getETag()).isEqualTo("\"3\"");
		assertUnchanged(ticket.id(), 3);
	}

	@Test
	void parallelEditsOfOneVersionWriteOnceAndRefuseOnlyADifferentValue() throws Exception {
		var ticket = fixtures.ticket(author).insert();
		var csrf = primeCsrf();
		var start = new CountDownLatch(1);
		var editors = 6;
		var calls = new ArrayList<Callable<ResponseEntity<Map<String, Object>>>>();
		for (int i = 0; i < editors; i++) {
			var title = i % 2 == 0 ? "Export fails" : "Import fails";
			calls.add(() -> {
				start.await();
				return patch(supportSession, csrf, ticket.reference(), "\"0\"",
						"{\"title\": \"%s\"}".formatted(title));
			});
		}
		var responses = new ArrayList<ResponseEntity<Map<String, Object>>>();
		try (var executor = Executors.newFixedThreadPool(editors)) {
			var futures = calls.stream().map(executor::submit).toList();
			start.countDown();
			for (var future : futures) {
				responses.add(future.get(30, TimeUnit.SECONDS));
			}
		}

		var stored = row(ticket.id()).title();
		for (int i = 0; i < editors; i++) {
			var response = responses.get(i);
			if ((i % 2 == 0 ? "Export fails" : "Import fails").equals(stored)) {
				assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
				assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
			}
			else {
				assertThat(response.getStatusCode()).isEqualTo(HttpStatus.PRECONDITION_FAILED);
				assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
			}
		}
		assertThat(row(ticket.id()).version()).isOne();
		assertThat(audits(ticket.id())).hasSize(1);
	}

	@Test
	void closedTicketIsAConflictForTheAuthorAndSupportAlike() {
		var ticket = fixtures.ticket(author).closedAfter(Duration.ofMinutes(5)).version(2).insert();

		for (var session : List.of(authorSession, supportSession)) {
			var response = patch(session, ticket.reference(), "\"2\"", "{\"title\": \"Clearer title\"}");

			assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
			assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/closed");
		}
		assertUnchanged(ticket.id(), 2);
	}

	@SuppressWarnings("unchecked")
	@Test
	void supportEditsATicketInProgressAndTheHistoryKeepsThePreviousText() {
		var ticket = fixtures.ticket(author).status("IN_PROGRESS").description("It is broken.").insert();

		var response = patch(supportSession, ticket.reference(), "\"0\"",
				"{\"description\": \"Saving a board with 600 tasks times out.\"}");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		var details = http().get().uri("/api/tickets/{reference}", ticket.reference())
				.header(HttpHeaders.COOKIE, "SESSION=" + authorSession)
				.retrieve()
				.body(JSON_OBJECT);
		assertThat((List<Map<String, Object>>) details.get("history")).last()
				.satisfies(entry -> assertThat(entry).containsEntry("field", "DESCRIPTION")
						.containsEntry("oldValue", "It is broken.")
						.containsEntry("newValue", "Saving a board with 600 tasks times out."));
	}

	private String login(UUID userId) {
		return login(fixtures.email(userId), TicketFixtures.PASSWORD);
	}

	private ResponseEntity<Map<String, Object>> patch(String session, String reference, @Nullable String ifMatch,
			String json) {
		return patch(session, primeCsrf(), reference, ifMatch, json);
	}

	private ResponseEntity<Map<String, Object>> patch(String session, CsrfPair csrf, String reference,
			@Nullable String ifMatch, String json) {
		var request = http().patch().uri("/api/tickets/{reference}", reference)
				.headers(headers -> {
					headers.set("X-XSRF-TOKEN", csrf.header());
					headers.set(HttpHeaders.COOKIE, csrf.cookie() + "; SESSION=" + session);
				})
				.contentType(MediaType.APPLICATION_JSON)
				.body(json);
		if (ifMatch != null) {
			request.header(HttpHeaders.IF_MATCH, ifMatch);
		}
		return request.retrieve().toEntity(JSON_OBJECT);
	}

	@SuppressWarnings("unchecked")
	private static void assertValidation(ResponseEntity<Map<String, Object>> response, String field, String code) {
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "validation");
		assertThat((List<Map<String, Object>>) response.getBody().get("errors"))
				.anySatisfy(error -> assertThat(error).containsEntry("field", field).containsEntry("code", code));
	}

	private void assertUnchanged(UUID ticketId, long version) {
		assertThat(row(ticketId).version()).isEqualTo(version);
		assertThat(audits(ticketId)).isEmpty();
	}

	private TicketRow row(UUID ticketId) {
		return jdbc.sql("SELECT title, description, version, updated_at FROM ticket WHERE id = :id")
				.param("id", ticketId)
				.query((rs, rowNum) -> new TicketRow(rs.getString("title"), rs.getString("description"),
						rs.getLong("version"), rs.getTimestamp("updated_at").toInstant()))
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

	private record TicketRow(String title, String description, long version, Instant updatedAt) {
	}

	private record StoredAudit(UUID actorId, Instant changedAt, String field, @Nullable String oldValue,
			@Nullable String newValue) {
	}

}
