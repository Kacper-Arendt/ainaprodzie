package app.retrofit.ticket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.InstanceOfAssertFactories.MAP;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import app.retrofit.RandomPortContext;

/// `GET /api/tickets`, `GET /api/tickets/counts` and `GET /api/tickets/{reference}` over the real server: the
/// session decides the caller, query parameters become the filter, and refusals are problem+json. What each caller
/// may see is covered by [TicketQueriesTests]; here it only has to reach the wire.
class TicketApiTests extends RandomPortContext {

	private static final String PROBLEMS = "https://retrofit.app/problems/";

	private static final ParameterizedTypeReference<Map<String, Object>> JSON_OBJECT = new ParameterizedTypeReference<>() {
	};

	TicketFixtures fixtures;

	@BeforeEach
	void setUp() {
		fixtures = new TicketFixtures(jdbc);
	}

	@Test
	void listingTicketsNeedsASession() {
		var response = http().get().uri("/api/tickets").retrieve().toEntity(JSON_OBJECT);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
	}

	@Test
	void customerListsTheirOrganizationsTicketsWithSlaFacts() {
		var organization = fixtures.organization(Duration.ofHours(4));
		var customer = fixtures.customer(organization);
		var ticket = fixtures.ticket(customer).title("Export does not work").createdAgo(Duration.ofHours(5)).insert();
		fixtures.ticket(fixtures.customer(fixtures.organization())).insert();
		var session = login(customer);

		var response = get(session, "/api/tickets?size=50");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody()).containsEntry("total", 1);
		var item = items(response).getFirst();
		assertThat(item).containsEntry("reference", ticket.reference())
				.containsEntry("title", "Export does not work")
				.containsEntry("status", "NEW")
				.containsEntry("team", null)
				.containsEntry("category", null);
		assertThat(item.get("sla")).asInstanceOf(MAP)
				.containsEntry("breached", true)
				.containsKeys("responseDeadline", "waitingSeconds");
	}

	@Test
	void queryParametersNarrowTheList() {
		var organization = fixtures.organization(Duration.ofHours(4));
		var customer = fixtures.customer(organization);
		var support = fixtures.support(fixtures.team());
		var overdue = fixtures.ticket(customer).createdAgo(Duration.ofHours(5)).insert();
		fixtures.ticket(customer).createdAgo(Duration.ofHours(1)).insert();
		var waiting = fixtures.ticket(customer).status("WAITING_FOR_CUSTOMER").createdAgo(Duration.ofHours(2))
				.answeredAfter(Duration.ofMinutes(30)).insert();
		var session = login(support);
		var base = "/api/tickets?organizationId=" + organization;

		assertThat(references(get(session, base + "&slaBreached=true"))).containsExactly(overdue.reference());
		assertThat(references(get(session, base + "&status=WAITING_FOR_CUSTOMER&status=RESOLVED")))
				.containsExactly(waiting.reference());
		assertThat(references(get(session, base + "&attention=PAST_DEADLINE"))).containsExactly(overdue.reference());
	}

	@Test
	void anUnansweredCustomerCommentReachesTheWireAndItsFilter() {
		var organization = fixtures.organization();
		var customer = fixtures.customer(organization);
		var support = fixtures.support(fixtures.team());
		var ticket = fixtures.ticket(customer).status("IN_PROGRESS").createdAgo(Duration.ofHours(3))
				.answeredAfter(Duration.ofHours(1)).insert();
		var commentedAt = ticket.createdAt().plus(Duration.ofHours(2));
		fixtures.comment(ticket.id(), support, false, "Which browser?", ticket.createdAt().plus(Duration.ofHours(1)));
		fixtures.comment(ticket.id(), customer, false, "Firefox.", commentedAt);
		var quiet = fixtures.ticket(customer).insert();
		var session = login(support);
		var base = "/api/tickets?organizationId=" + organization;

		var all = items(get(session, base));
		var filtered = get(session, base + "&attention=UNANSWERED_CUSTOMER_COMMENT");
		var unknown = get(session, base + "&attention=SOON");

		assertThat(all).filteredOn(item -> item.get("reference").equals(ticket.reference())).singleElement()
				.extracting(item -> Instant.parse((String) item.get("unansweredCustomerCommentAt")))
				.isEqualTo(commentedAt);
		assertThat(all).filteredOn(item -> item.get("reference").equals(quiet.reference())).singleElement()
				.asInstanceOf(MAP).containsEntry("unansweredCustomerCommentAt", null);
		assertThat(references(filtered)).containsExactly(ticket.reference());
		assertThat(unknown.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
	}

	@Test
	void authorCreationAndDeadlineParametersNarrowTheList() {
		var organization = fixtures.organization(Duration.ofHours(4));
		var customer = fixtures.customer(organization);
		var colleague = fixtures.customer(organization);
		var raisedToday = fixtures.ticket(customer).createdAgo(Duration.ofHours(1)).insert();
		var raisedLastWeek = fixtures.ticket(customer).createdAgo(Duration.ofDays(7)).insert();
		var colleagues = fixtures.ticket(colleague).createdAgo(Duration.ofHours(3)).insert();
		var session = login(customer);
		var dayAgo = Instant.now().minus(Duration.ofDays(1)).truncatedTo(ChronoUnit.SECONDS);
		var inTwoHours = Instant.now().plus(Duration.ofHours(2)).truncatedTo(ChronoUnit.SECONDS);

		assertThat(references(get(session, "/api/tickets?authorId=" + customer)))
				.containsExactlyInAnyOrder(raisedToday.reference(), raisedLastWeek.reference());
		assertThat(references(get(session, "/api/tickets?createdFrom=" + dayAgo)))
				.containsExactlyInAnyOrder(raisedToday.reference(), colleagues.reference());
		assertThat(references(get(session, "/api/tickets?createdTo=" + dayAgo)))
				.containsExactly(raisedLastWeek.reference());
		assertThat(references(get(session, "/api/tickets?deadlineBefore=" + inTwoHours)))
				.containsExactlyInAnyOrder(raisedLastWeek.reference(), colleagues.reference());
	}

	@Test
	void blankParametersNarrowNothing() {
		var organization = fixtures.organization();
		var customer = fixtures.customer(organization);
		var waiting = fixtures.ticket(customer).status("WAITING_FOR_CUSTOMER").insert();
		var fresh = fixtures.ticket(customer).insert();
		var session = login(fixtures.support(fixtures.team()));
		var base = "/api/tickets?organizationId=" + organization;

		var blankAmongValues = get(session, base + "&status=WAITING_FOR_CUSTOMER&status=");
		var onlyBlank = get(session, base + "&status=&priority=&category=");

		assertThat(references(blankAmongValues)).containsExactly(waiting.reference());
		assertThat(references(onlyBlank)).containsExactlyInAnyOrder(waiting.reference(), fresh.reference());
	}

	@Test
	void supportStaffReadTheDeskCountsAndACustomerIsRefused() {
		var customer = fixtures.customer(fixtures.organization());

		var support = get(login(fixtures.support(fixtures.team())), "/api/tickets/counts");
		var refused = get(login(customer), "/api/tickets/counts");

		assertThat(support.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(support.getBody()).containsOnlyKeys("all", "assignedToMe", "myTeam", "pastDeadline",
				"dueWithinHour", "unassigned", "unansweredCustomerComment");
		assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
		assertThat(refused.getBody()).containsEntry("type", PROBLEMS + "ticket/forbidden");
	}

	@Test
	void customersReadTheirOrganizationsCountsAndSupportStaffAreRefused() {
		var organization = fixtures.organization();
		var customer = fixtures.customer(organization);
		fixtures.ticket(customer).status("WAITING_FOR_CUSTOMER").insert();
		fixtures.ticket(fixtures.customer(organization)).insert();
		fixtures.ticket(fixtures.customer(fixtures.organization())).status("WAITING_FOR_CUSTOMER").insert();

		var counts = get(login(customer), "/api/tickets/customer-counts");
		var refused = get(login(fixtures.support(fixtures.team())), "/api/tickets/customer-counts");

		assertThat(counts.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(counts.getBody()).containsExactlyInAnyOrderEntriesOf(
				Map.of("all", 2, "waitingForCustomer", 1, "raisedByMe", 1));
		assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
		assertThat(refused.getBody()).containsEntry("type", PROBLEMS + "ticket/forbidden");
	}

	@Test
	void detailsOfATicketTheCallerMayNotSeeAreNotFound() {
		var customer = fixtures.customer(fixtures.organization());
		var foreign = fixtures.ticket(fixtures.customer(fixtures.organization())).insert();
		var own = fixtures.ticket(customer).description("Steps to reproduce.").insert();
		var session = login(customer);

		var ownResponse = get(session, "/api/tickets/" + own.reference());
		var foreignResponse = get(session, "/api/tickets/" + foreign.reference());

		assertThat(ownResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(ownResponse.getBody()).containsEntry("description", "Steps to reproduce.")
				.containsKeys("summary", "comments", "history", "links");
		assertThat(foreignResponse.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(foreignResponse.getBody()).containsEntry("type", PROBLEMS + "ticket/not-found");
	}

	@Test
	void detailsAnswerTheVersionAsETag() {
		var customer = fixtures.customer(fixtures.organization());
		var ticket = fixtures.ticket(customer).insert();
		jdbc.sql("UPDATE ticket SET version = 5 WHERE id = :id").param("id", ticket.id()).update();
		var session = login(customer);

		var response = get(session, "/api/tickets/" + ticket.reference());

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody()).containsEntry("version", 5);
		assertThat(response.getHeaders().getETag()).isEqualTo("\"5\"");
	}

	@Test
	void everyCommentOfTheDetailsCarriesItsId() {
		var customer = fixtures.customer(fixtures.organization());
		var ticket = fixtures.ticket(customer).insert();
		fixtures.comment(ticket.id(), customer, false, "First.", ticket.createdAt().plus(Duration.ofMinutes(1)));
		fixtures.comment(ticket.id(), customer, false, "Second.", ticket.createdAt().plus(Duration.ofMinutes(2)));
		var ids = jdbc.sql("SELECT CAST(id AS text) FROM ticket_comment WHERE ticket_id = :id ORDER BY created_at")
				.param("id", ticket.id())
				.query(String.class)
				.list();
		var session = login(customer);

		var response = get(session, "/api/tickets/" + ticket.reference());

		assertThat(comments(response)).extracting(comment -> comment.get("id")).containsExactlyElementsOf(ids);
	}

	@Test
	void anOutOfRangePageIsAValidationProblemAndAnUnknownStatusIsMalformed() {
		var session = login(fixtures.support(fixtures.team()));

		var tooLarge = get(session, "/api/tickets?size=500&page=-1");
		var unknownStatus = get(session, "/api/tickets?status=OPEN");

		assertThat(tooLarge.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
		assertThat(tooLarge.getBody()).containsEntry("type", PROBLEMS + "validation");
		assertThat(errorCodes(tooLarge)).containsExactlyInAnyOrder("page.invalid", "size.invalid");
		assertThat(unknownStatus.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(unknownStatus.getBody()).containsEntry("type", PROBLEMS + "malformed-request");
	}

	@Test
	void aCreationRangeThatEndsBeforeItStartsIsAValidationProblem() {
		var session = login(fixtures.support(fixtures.team()));

		var inverted = get(session, "/api/tickets?createdFrom=2026-10-14T12:00:00Z&createdTo=2026-10-14T11:59:59Z");
		var empty = get(session, "/api/tickets?createdFrom=2026-10-14T12:00:00Z&createdTo=2026-10-14T12:00:00Z");

		assertThat(inverted.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
		assertThat(inverted.getBody()).containsEntry("type", PROBLEMS + "validation");
		assertThat(errorCodes(inverted)).containsExactly("createdTo.invalid");
		assertThat(empty.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(empty.getBody()).containsEntry("total", 0);
	}

	@Test
	void anInstantBeyondTheYear9999IsAValidationProblemNamingTheParameter() {
		var session = login(fixtures.support(fixtures.team()));

		var response = get(session, "/api/tickets?createdFrom={createdFrom}&deadlineBefore={deadlineBefore}",
				"+10000-01-01T00:00:00Z", "+1000000000-01-01T00:00:00Z");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "validation");
		assertThat(errorCodes(response)).containsExactlyInAnyOrder("createdFrom.invalid", "deadlineBefore.invalid");
	}

	@Test
	void pageAndFilterProblemsAreReportedTogether() {
		var session = login(fixtures.support(fixtures.team()));

		var response = get(session, "/api/tickets?size=500&createdFrom=2026-10-14T12:00:00Z"
				+ "&createdTo=2026-10-14T11:00:00Z");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
		assertThat(errorCodes(response)).containsExactlyInAnyOrder("size.invalid", "createdTo.invalid");
	}

	private String login(UUID userId) {
		var email = jdbc.sql("SELECT email FROM app_user WHERE id = :id").param("id", userId).query(String.class)
				.single();
		return login(email, "x");
	}

	/// `uriVariables` are encoded strictly, so a `+` in an instant reaches the server as a `+`, not a space.
	private ResponseEntity<Map<String, Object>> get(String session, String uri, Object... uriVariables) {
		return http().get().uri(uri, uriVariables).header(HttpHeaders.COOKIE, "SESSION=" + session).retrieve().toEntity(JSON_OBJECT);
	}

	@SuppressWarnings("unchecked")
	private static List<Map<String, Object>> items(ResponseEntity<Map<String, Object>> response) {
		return (List<Map<String, Object>>) response.getBody().get("items");
	}

	@SuppressWarnings("unchecked")
	private static List<Map<String, Object>> comments(ResponseEntity<Map<String, Object>> response) {
		return (List<Map<String, Object>>) response.getBody().get("comments");
	}

	@SuppressWarnings("unchecked")
	private static List<Object> errorCodes(ResponseEntity<Map<String, Object>> response) {
		return ((List<Map<String, Object>>) response.getBody().get("errors")).stream().map(error -> error.get("code"))
				.toList();
	}

	private static List<Object> references(ResponseEntity<Map<String, Object>> response) {
		return items(response).stream().map(item -> item.get("reference")).toList();
	}

}
