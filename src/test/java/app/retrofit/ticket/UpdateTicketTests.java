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

/// `PATCH /api/tickets/{reference}` over the real server with real commits: merge-patch semantics, the team and
/// assignee rules, one audit entry per changed field, the `If-Match` rules and a race between edits of one version.
/// Bodies are sent as raw JSON, so absent and `null` fields are exactly what the test writes.
class UpdateTicketTests extends RandomPortContext {

	private static final String PROBLEMS = "https://retrofit.app/problems/";

	private static final ParameterizedTypeReference<Map<String, Object>> JSON_OBJECT = new ParameterizedTypeReference<>() {
	};

	TicketFixtures fixtures;

	UUID organization;

	UUID author;

	UUID firstLine;

	UUID secondLine;

	UUID support;

	UUID colleague;

	UUID specialist;

	String customerSession;

	String supportSession;

	@BeforeEach
	void setUp() {
		fixtures = new TicketFixtures(jdbc);
		organization = fixtures.organization();
		author = fixtures.customer(organization);
		firstLine = fixtures.team();
		secondLine = fixtures.team();
		support = fixtures.support(firstLine);
		colleague = fixtures.support(firstLine);
		specialist = fixtures.support(secondLine);
		customerSession = login(author);
		supportSession = login(support);
	}

	@Test
	void customerIsForbidden() {
		var ticket = fixtures.ticket(author).insert();

		var response = patch(customerSession, ticket.reference(), "\"0\"", "{\"priority\": \"HIGH\"}");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/forbidden");
		assertUnchanged(ticket.id(), 0);
	}

	@Test
	void customerOfAnotherOrganizationGetsNotFound() {
		var ticket = fixtures.ticket(fixtures.customer(fixtures.organization())).insert();

		var response = patch(customerSession, ticket.reference(), "\"0\"", "{\"priority\": \"HIGH\"}");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/not-found");
		assertUnchanged(ticket.id(), 0);
	}

	@Test
	void everyChangedFieldIsAuditedWithNamesAndTheVersionMovesOnce() {
		var ticket = fixtures.ticket(author).category("BUG").team(firstLine).assignee(colleague)
				.updatedAgo(Duration.ofMinutes(30)).insert();

		var response = patch(supportSession, ticket.reference(), "\"0\"", """
				{"status": "IN_PROGRESS", "priority": "HIGH", "category": "QUESTION", "teamId": "%s",
				 "assigneeId": "%s"}
				""".formatted(secondLine, specialist));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
		assertThat(response.getBody()).containsEntry("version", 1);
		var row = row(ticket.id());
		assertThat(row).isEqualTo(new TicketRow("IN_PROGRESS", "HIGH", "QUESTION", secondLine, specialist, 1,
				row.updatedAt()));
		assertThat(row.updatedAt()).isAfter(Instant.now().minus(Duration.ofMinutes(1)));
		assertThat(audits(ticket.id())).containsExactlyInAnyOrder(
				new StoredAudit(support, row.updatedAt(), "STATUS", "NEW", "IN_PROGRESS"),
				new StoredAudit(support, row.updatedAt(), "PRIORITY", "NORMAL", "HIGH"),
				new StoredAudit(support, row.updatedAt(), "CATEGORY", "BUG", "QUESTION"),
				new StoredAudit(support, row.updatedAt(), "TEAM", fixtures.teamName(firstLine),
						fixtures.teamName(secondLine)),
				new StoredAudit(support, row.updatedAt(), "ASSIGNEE", fixtures.displayName(colleague),
						fixtures.displayName(specialist)));
	}

	@Test
	void unchangedFieldsWriteNothing() {
		var ticket = fixtures.ticket(author).status("IN_PROGRESS").team(firstLine).assignee(colleague).version(2)
				.insert();

		var response = patch(supportSession, ticket.reference(), "\"2\"", """
				{"status": "IN_PROGRESS", "priority": "LOW", "teamId": "%s", "assigneeId": "%s"}
				""".formatted(firstLine, colleague));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getHeaders().getETag()).isEqualTo("\"3\"");
		assertThat(row(ticket.id()).version()).isEqualTo(3);
		assertThat(audits(ticket.id())).extracting(StoredAudit::field, StoredAudit::oldValue, StoredAudit::newValue)
				.containsExactly(tuple("PRIORITY", "NORMAL", "LOW"));
	}

	@Test
	void emptyAndNoOpPatchesKeepTheVersionAndUpdatedAt() {
		var ticket = fixtures.ticket(author).category("BUG").team(firstLine).assignee(colleague).version(5)
				.updatedAgo(Duration.ofMinutes(30)).insert();
		var before = row(ticket.id());

		var empty = patch(supportSession, ticket.reference(), "\"5\"", "{}");
		var noOp = patch(supportSession, ticket.reference(), "\"5\"", """
				{"status": "NEW", "priority": "NORMAL", "category": "BUG", "teamId": "%s", "assigneeId": "%s",
				 "unknownProperty": [1, 2]}
				""".formatted(firstLine, colleague));

		for (var response : List.of(empty, noOp)) {
			assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
			assertThat(response.getHeaders().getETag()).isEqualTo("\"5\"");
			assertThat(response.getBody()).containsEntry("version", 5);
		}
		assertThat(row(ticket.id())).isEqualTo(before);
		assertThat(audits(ticket.id())).isEmpty();
	}

	@Test
	void noOpPatchSucceedsWhateverTheTag() {
		var ticket = fixtures.ticket(author).version(5).insert();

		for (var ifMatch : Arrays.asList("\"4\"", "*", null)) {
			var response = patch(supportSession, ticket.reference(), ifMatch, "{\"priority\": \"NORMAL\"}");

			assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
			assertThat(response.getHeaders().getETag()).isEqualTo("\"5\"");
		}
		assertUnchanged(ticket.id(), 5);
	}

	@Test
	void retryAfterASuccessfulEditAnswersTheTicketWithoutAnotherAudit() {
		var ticket = fixtures.ticket(author).insert();

		var first = patch(supportSession, ticket.reference(), "\"0\"", "{\"status\": \"IN_PROGRESS\"}");
		var retry = patch(supportSession, ticket.reference(), "\"0\"", "{\"status\": \"IN_PROGRESS\"}");

		for (var response : List.of(first, retry)) {
			assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
			assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
		}
		assertThat(row(ticket.id()).version()).isOne();
		assertThat(audits(ticket.id())).extracting(StoredAudit::field).containsExactly("STATUS");
	}

	@Test
	void editFromTheSameStaleReadAskingForADifferentValueIsModified() {
		var ticket = fixtures.ticket(author).insert();
		patch(supportSession, ticket.reference(), "\"0\"", "{\"status\": \"IN_PROGRESS\"}");

		var response = patch(supportSession, ticket.reference(), "\"0\"",
				"{\"status\": \"WAITING_FOR_CUSTOMER\"}");

		assertModified(response, "\"1\"");
		assertThat(row(ticket.id()).status()).isEqualTo("IN_PROGRESS");
		assertThat(audits(ticket.id())).hasSize(1);
	}

	@Test
	void noOpPatchOnAClosedTicketAnswersIt() {
		var ticket = fixtures.ticket(author).closedAfter(Duration.ofMinutes(5)).version(2).insert();

		var response = patch(supportSession, ticket.reference(), "\"1\"", "{\"priority\": \"NORMAL\"}");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getHeaders().getETag()).isEqualTo("\"2\"");
		assertThat(row(ticket.id()).status()).isEqualTo("CLOSED");
		assertUnchanged(ticket.id(), 2);
	}

	@Test
	void customerIsForbiddenEvenFromANoOp() {
		var ticket = fixtures.ticket(author).insert();

		var response = patch(customerSession, ticket.reference(), "\"0\"", "{}");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
		assertUnchanged(ticket.id(), 0);
	}

	@Test
	void nullClearsCategoryAndTeamWithItsAssigneeWhileAbsentFieldsStay() {
		var ticket = fixtures.ticket(author).priority("HIGH").category("BUG").team(firstLine).assignee(colleague)
				.insert();

		var response = patch(supportSession, ticket.reference(), "\"0\"", "{\"category\": null, \"teamId\": null}");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		var row = row(ticket.id());
		assertThat(row).isEqualTo(new TicketRow("NEW", "HIGH", null, null, null, 1, row.updatedAt()));
		assertThat(audits(ticket.id())).extracting(StoredAudit::field, StoredAudit::oldValue, StoredAudit::newValue)
				.containsExactlyInAnyOrder(tuple("CATEGORY", "BUG", null),
						tuple("TEAM", fixtures.teamName(firstLine), null),
						tuple("ASSIGNEE", fixtures.displayName(colleague), null));
	}

	@Test
	void nullAssigneeUnassignsAndKeepsTheTeam() {
		var ticket = fixtures.ticket(author).team(firstLine).assignee(colleague).insert();

		var response = patch(supportSession, ticket.reference(), "\"0\"", "{\"assigneeId\": null}");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		var row = row(ticket.id());
		assertThat(row.teamId()).isEqualTo(firstLine);
		assertThat(row.assigneeId()).isNull();
		assertThat(audits(ticket.id())).extracting(StoredAudit::field, StoredAudit::oldValue, StoredAudit::newValue)
				.containsExactly(tuple("ASSIGNEE", fixtures.displayName(colleague), null));
	}

	@Test
	void reassigningToANamesakeOfTheAssigneeIsAuditedWithOneNameTwice() {
		var namesake = fixtures.namesake(colleague, firstLine);
		var ticket = fixtures.ticket(author).team(firstLine).assignee(colleague).insert();

		var response = patch(supportSession, ticket.reference(), "\"0\"",
				"{\"assigneeId\": \"%s\"}".formatted(namesake));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(row(ticket.id()).assigneeId()).isEqualTo(namesake);
		var name = fixtures.displayName(colleague);
		assertThat(audits(ticket.id())).extracting(StoredAudit::field, StoredAudit::oldValue, StoredAudit::newValue)
				.containsExactly(tuple("ASSIGNEE", name, name));
	}

	@Test
	void closedStatusIsRefused() {
		var ticket = fixtures.ticket(author).insert();

		var response = patch(supportSession, ticket.reference(), "\"0\"", "{\"status\": \"CLOSED\"}");

		assertValidation(response, "status", "status.closed");
		assertUnchanged(ticket.id(), 0);
	}

	@Test
	void statusMovesOnlyAlongTheLifecycle() {
		var started = fixtures.ticket(author).status("IN_PROGRESS").insert();
		var resolved = fixtures.ticket(author).status("RESOLVED").resolution("Fixed").insert();

		assertValidation(patch(supportSession, started.reference(), "\"0\"", "{\"status\": \"NEW\"}"), "status",
				"status.not-allowed");
		assertValidation(patch(supportSession, resolved.reference(), "\"0\"",
				"{\"status\": \"WAITING_FOR_CUSTOMER\"}"), "status", "status.not-allowed");
		assertUnchanged(started.id(), 0);
		assertUnchanged(resolved.id(), 0);
	}

	@Test
	void resolvingNeedsAResolution() {
		var ticket = fixtures.ticket(author).status("IN_PROGRESS").insert();

		assertValidation(patch(supportSession, ticket.reference(), "\"0\"", "{\"status\": \"RESOLVED\"}"),
				"resolution", "field.required");
		assertValidation(patch(supportSession, ticket.reference(), "\"0\"",
				"{\"status\": \"RESOLVED\", \"resolution\": \" \"}"), "resolution", "field.required");
		assertUnchanged(ticket.id(), 0);
	}

	@Test
	void resolvingStoresAndAuditsTheResolution() {
		var ticket = fixtures.ticket(author).status("WAITING_FOR_CUSTOMER").insert();

		var response = patch(supportSession, ticket.reference(), "\"0\"",
				"{\"status\": \"RESOLVED\", \"resolution\": \"Fixed in 2.3\"}");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody()).containsEntry("resolution", "Fixed in 2.3");
		var row = row(ticket.id());
		assertThat(row.status()).isEqualTo("RESOLVED");
		assertThat(row.version()).isOne();
		assertThat(audits(ticket.id())).containsExactly(
				new StoredAudit(support, row.updatedAt(), "STATUS", "WAITING_FOR_CUSTOMER", "RESOLVED"),
				new StoredAudit(support, row.updatedAt(), "RESOLUTION", null, "Fixed in 2.3"));
	}

	@Test
	void reopenedTicketIsResolvedAgainWithItsStoredResolution() {
		var ticket = fixtures.ticket(author).status("RESOLVED").resolution("Fixed").insert();

		assertThat(patch(supportSession, ticket.reference(), "\"0\"", "{\"status\": \"IN_PROGRESS\"}")
				.getBody()).containsEntry("resolution", "Fixed");
		var response = patch(supportSession, ticket.reference(), "\"1\"", "{\"status\": \"RESOLVED\"}");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody()).containsEntry("resolution", "Fixed");
		assertThat(audits(ticket.id())).extracting(StoredAudit::field).containsExactly("STATUS", "STATUS");
	}

	@Test
	void resolutionIsTakenOnlyByAResolvedTicket() {
		var open = fixtures.ticket(author).status("IN_PROGRESS").insert();
		var resolved = fixtures.ticket(author).status("RESOLVED").resolution("Fixed").insert();

		assertValidation(patch(supportSession, open.reference(), "\"0\"", "{\"resolution\": \"Fixed\"}"),
				"resolution", "resolution.not-resolved");
		assertValidation(patch(supportSession, resolved.reference(), "\"0\"", "{\"resolution\": null}"),
				"resolution", "field.required");
		assertValidation(patch(supportSession, resolved.reference(), "\"0\"",
				"{\"resolution\": \"Nul \\u0000 here\"}"), "resolution", "field.invalid");
		assertValidation(patch(supportSession, resolved.reference(), "\"0\"",
				"{\"resolution\": \"%s\"}".formatted("r".repeat(2_001))), "resolution", "field.too-long");
		assertUnchanged(open.id(), 0);
		assertUnchanged(resolved.id(), 0);
	}

	@Test
	void nullStatusOrPriorityIsRequired() {
		var ticket = fixtures.ticket(author).insert();

		assertValidation(patch(supportSession, ticket.reference(), "\"0\"", "{\"status\": null}"), "status",
				"field.required");
		assertValidation(patch(supportSession, ticket.reference(), "\"0\"", "{\"priority\": null}"), "priority",
				"field.required");
		assertValidation(patch(supportSession, ticket.reference(), "\"0\"", "{\"priority\": \"SOON\"}"), "priority",
				"priority.unknown");
		assertUnchanged(ticket.id(), 0);
	}

	@Test
	void wrongJsonTypesAreMalformed() {
		var ticket = fixtures.ticket(author).insert();

		for (var body : List.of("{\"teamId\": \"not-a-uuid\"}", "{\"assigneeId\": 7}", "{\"status\": 5}",
				"{\"priority\": {}}", "{\"category\": [\"BUG\"]}", "[]", "null")) {
			assertMalformed(patch(supportSession, ticket.reference(), "\"0\"", body));
		}
		assertUnchanged(ticket.id(), 0);
	}

	@Test
	void wrongJsonTypesAreMalformedBeforeTheTicketIsLookedUp() {
		var hidden = fixtures.ticket(fixtures.customer(fixtures.organization())).insert();

		assertMalformed(patch(customerSession, hidden.reference(), "\"0\"", "{\"teamId\": \"not-a-uuid\"}"));
		assertMalformed(patch(supportSession, "RET-999999999", "\"0\"", "{\"teamId\": \"not-a-uuid\"}"));
	}

	@Test
	void unknownTeamAndAssigneeAreRefused() {
		var ticket = fixtures.ticket(author).team(firstLine).insert();

		assertValidation(patch(supportSession, ticket.reference(), "\"0\"",
				"{\"teamId\": \"%s\"}".formatted(UUID.randomUUID())), "teamId", "teamId.unknown");
		assertValidation(patch(supportSession, ticket.reference(), "\"0\"",
				"{\"assigneeId\": \"%s\"}".formatted(UUID.randomUUID())), "assigneeId", "assigneeId.unknown");
		assertValidation(patch(supportSession, ticket.reference(), "\"0\"",
				"{\"assigneeId\": \"%s\"}".formatted(author)), "assigneeId", "assigneeId.unknown");
		assertUnchanged(ticket.id(), 0);
	}

	@Test
	void assigneeMustBeAnEnabledMemberOfTheResultingTeam() {
		var ticket = fixtures.ticket(author).team(firstLine).insert();
		var untriaged = fixtures.ticket(author).insert();
		var disabled = fixtures.disabledSupport(firstLine);

		assertValidation(patch(supportSession, ticket.reference(), "\"0\"",
				"{\"assigneeId\": \"%s\"}".formatted(specialist)), "assigneeId", "assigneeId.not-in-team");
		assertValidation(patch(supportSession, ticket.reference(), "\"0\"",
				"{\"assigneeId\": \"%s\"}".formatted(disabled)), "assigneeId", "assigneeId.not-in-team");
		assertValidation(patch(supportSession, ticket.reference(), "\"0\"",
				"{\"teamId\": \"%s\", \"assigneeId\": \"%s\"}".formatted(secondLine, colleague)), "assigneeId",
				"assigneeId.not-in-team");
		assertValidation(patch(supportSession, untriaged.reference(), "\"0\"",
				"{\"assigneeId\": \"%s\"}".formatted(colleague)), "assigneeId", "assigneeId.not-in-team");
		assertUnchanged(ticket.id(), 0);
		assertUnchanged(untriaged.id(), 0);

		var moved = patch(supportSession, ticket.reference(), "\"0\"",
				"{\"teamId\": \"%s\", \"assigneeId\": \"%s\"}".formatted(secondLine, specialist));
		assertThat(moved.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(row(ticket.id()).assigneeId()).isEqualTo(specialist);
	}

	@Test
	void teamChangeWithoutAnAssigneeClearsTheAssignee() {
		var ticket = fixtures.ticket(author).team(firstLine).assignee(colleague).insert();

		var response = patch(supportSession, ticket.reference(), "\"0\"",
				"{\"teamId\": \"%s\"}".formatted(secondLine));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		var row = row(ticket.id());
		assertThat(row.teamId()).isEqualTo(secondLine);
		assertThat(row.assigneeId()).isNull();
		assertThat(audits(ticket.id())).extracting(StoredAudit::field, StoredAudit::oldValue, StoredAudit::newValue)
				.containsExactlyInAnyOrder(tuple("TEAM", fixtures.teamName(firstLine), fixtures.teamName(secondLine)),
						tuple("ASSIGNEE", fixtures.displayName(colleague), null));
	}

	@Test
	void disabledStoredAssigneeStaysOnAnEditThatDoesNotNameAnAssignee() {
		var disabled = fixtures.disabledSupport(firstLine);
		var ticket = fixtures.ticket(author).team(firstLine).assignee(disabled).insert();

		var response = patch(supportSession, ticket.reference(), "\"0\"", "{\"priority\": \"CRITICAL\"}");
		var resent = patch(supportSession, ticket.reference(), "\"1\"",
				"{\"assigneeId\": \"%s\"}".formatted(disabled));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(resent.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(resent.getHeaders().getETag()).isEqualTo("\"1\"");
		var row = row(ticket.id());
		assertThat(row.priority()).isEqualTo("CRITICAL");
		assertThat(row.assigneeId()).isEqualTo(disabled);
		assertThat(audits(ticket.id())).extracting(StoredAudit::field).containsExactly("PRIORITY");
	}

	@Test
	void closedTicketIsAConflict() {
		var ticket = fixtures.ticket(author).closedAfter(Duration.ofMinutes(5)).version(2).insert();

		var response = patch(supportSession, ticket.reference(), "\"2\"", "{\"priority\": \"HIGH\"}");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/closed");
		assertThat(row(ticket.id()).version()).isEqualTo(2);
		assertThat(audits(ticket.id())).isEmpty();
	}

	@Test
	void statusChangeOnAClosedTicketIsAConflictRatherThanAnInvalidMove() {
		var ticket = fixtures.ticket(author).closedAfter(Duration.ofMinutes(5)).version(2).insert();

		for (var body : List.of("{\"status\": \"IN_PROGRESS\"}",
				"{\"status\": \"RESOLVED\", \"resolution\": \"Done\"}")) {
			var response = patch(supportSession, ticket.reference(), "\"2\"", body);

			assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
			assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/closed");
		}
		assertUnchanged(ticket.id(), 2);
	}

	@Test
	void staleStatusChangeAnswersModifiedRatherThanAnInvalidMove() {
		// Read at version 1 while NEW; someone has since resolved it.
		var ticket = fixtures.ticket(author).status("RESOLVED").resolution("Fixed").version(2).insert();

		assertModified(
				patch(supportSession, ticket.reference(), "\"1\"", "{\"status\": \"WAITING_FOR_CUSTOMER\"}"),
				"\"2\"");
		assertModified(patch(supportSession, ticket.reference(), "\"1\"", "{\"status\": \"NEW\"}"), "\"2\"");
		assertUnchanged(ticket.id(), 2);
	}

	@Test
	void missingIfMatchIsRequired() {
		var ticket = fixtures.ticket(author).insert();

		var response = patch(supportSession, ticket.reference(), null, "{\"priority\": \"HIGH\"}");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.PRECONDITION_REQUIRED);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/precondition-required");
		assertUnchanged(ticket.id(), 0);
	}

	@Test
	void staleIfMatchAnswersWithTheCurrentTag() {
		var ticket = fixtures.ticket(author).version(3).insert();

		var response = patch(supportSession, ticket.reference(), "\"2\"", "{\"priority\": \"HIGH\"}");

		assertModified(response, "\"3\"");
		assertUnchanged(ticket.id(), 3);
	}

	@Test
	void parallelPatchesOnOneVersionWriteOnceAndRefuseOnlyADifferentValue() throws Exception {
		var ticket = fixtures.ticket(author).insert();
		var csrf = primeCsrf();
		var start = new CountDownLatch(1);
		var editors = 6;
		var calls = new ArrayList<Callable<ResponseEntity<Map<String, Object>>>>();
		for (int i = 0; i < editors; i++) {
			var priority = i % 2 == 0 ? "HIGH" : "LOW";
			calls.add(() -> {
				start.await();
				return patch(supportSession, csrf, ticket.reference(), "\"0\"",
						"{\"priority\": \"%s\"}".formatted(priority));
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

		var stored = row(ticket.id()).priority();
		for (int i = 0; i < editors; i++) {
			var response = responses.get(i);
			if ((i % 2 == 0 ? "HIGH" : "LOW").equals(stored)) {
				assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
				assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
			}
			else {
				assertModified(response, "\"1\"");
			}
		}
		assertThat(row(ticket.id()).version()).isOne();
		assertThat(audits(ticket.id())).hasSize(1);
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

	/// The body `ProblemDetailAdvice` answers for any unreadable request body.
	private static void assertMalformed(ResponseEntity<Map<String, Object>> response) {
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "malformed-request")
				.containsEntry("title", "Malformed request")
				.containsEntry("status", 400)
				.containsEntry("detail", "The request body could not be read.")
				.containsEntry("errors", List.of());
	}

	private static void assertModified(ResponseEntity<Map<String, Object>> response, String currentTag) {
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.PRECONDITION_FAILED);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "ticket/modified");
		assertThat(response.getHeaders().getETag()).isEqualTo(currentTag);
	}

	private void assertUnchanged(UUID ticketId, long version) {
		assertThat(row(ticketId).version()).isEqualTo(version);
		assertThat(audits(ticketId)).isEmpty();
	}

	private TicketRow row(UUID ticketId) {
		return jdbc.sql("""
				SELECT status, priority, category, team_id, assignee_id, version, updated_at FROM ticket WHERE id = :id
				""")
				.param("id", ticketId)
				.query((rs, rowNum) -> new TicketRow(rs.getString("status"), rs.getString("priority"),
						rs.getString("category"), rs.getObject("team_id", UUID.class),
						rs.getObject("assignee_id", UUID.class), rs.getLong("version"),
						rs.getTimestamp("updated_at").toInstant()))
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

	private record TicketRow(String status, String priority, @Nullable String category, @Nullable UUID teamId,
			@Nullable UUID assigneeId, long version, Instant updatedAt) {
	}

	private record StoredAudit(UUID actorId, Instant changedAt, String field, @Nullable String oldValue,
			@Nullable String newValue) {
	}

}
