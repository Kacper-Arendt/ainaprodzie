package app.retrofit.ticket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.assertj.core.groups.Tuple;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

import app.retrofit.RandomPortContext;

/// `PUT` and `DELETE /api/tickets/{reference}/links/{linkedReference}` over the real server with real commits: the
/// stored direction, the side-aware audit entries on both tickets, the version bumps, the writes that change nothing,
/// the refusals and the commands racing on one pair.
class LinkTicketTests extends RandomPortContext {

	private static final String PROBLEMS = "https://retrofit.app/problems/";

	private static final ParameterizedTypeReference<Map<String, Object>> JSON_OBJECT = new ParameterizedTypeReference<>() {
	};

	TicketFixtures fixtures;

	UUID author;

	UUID support;

	String supportSession;

	@BeforeEach
	void setUp() {
		fixtures = new TicketFixtures(jdbc);
		author = fixtures.customer(fixtures.organization());
		support = fixtures.support(fixtures.team());
		supportSession = login(fixtures.email(support), TicketFixtures.PASSWORD);
	}

	@Test
	void supportLinksTwoTicketsAsRelatedAndAuditsBothSides() {
		var earlier = fixtures.ticket(author).insert();
		var later = fixtures.ticket(author).insert();

		var response = link(earlier.reference(), later.reference(), "RELATED");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
		assertThat(response.getBody()).containsEntry("version", 1);
		assertThat(linksOf(response)).singleElement().satisfies(link -> assertThat(link)
				.containsEntry("relation", "RELATED").containsEntry("reference", later.reference()));
		assertThat(storedLinks(earlier.id(), later.id()))
				.containsExactly(new StoredLink(later.id(), earlier.id(), "RELATED", support));
		var earlierRow = row(earlier.id());
		var laterRow = row(later.id());
		assertThat(earlierRow.version()).isOne();
		assertThat(laterRow.version()).isOne();
		assertThat(audits(earlier.id())).containsExactly(
				new StoredAudit(support, earlierRow.updatedAt(), null, "RELATED " + later.reference()));
		assertThat(audits(later.id())).containsExactly(
				new StoredAudit(support, laterRow.updatedAt(), null, "RELATED " + earlier.reference()));
		assertThat(laterRow.updatedAt()).isEqualTo(earlierRow.updatedAt());
	}

	@Test
	void potentialDuplicateFromTheEarlierTicketIsStoredFromTheLaterOne() {
		var earlier = fixtures.ticket(author).insert();
		var later = fixtures.ticket(author).insert();

		var response = link(earlier.reference(), later.reference(), "POTENTIAL_DUPLICATE");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(linksOf(response)).singleElement().satisfies(link -> assertThat(link)
				.containsEntry("relation", "HAS_POTENTIAL_DUPLICATE").containsEntry("reference", later.reference()));
		assertThat(storedLinks(earlier.id(), later.id()))
				.containsExactly(new StoredLink(later.id(), earlier.id(), "POTENTIAL_DUPLICATE", support));
		assertThat(audits(earlier.id())).extracting(StoredAudit::oldValue, StoredAudit::newValue)
				.containsExactly(tuple(null,
						"HAS_POTENTIAL_DUPLICATE " + later.reference()));
		assertThat(audits(later.id())).extracting(StoredAudit::oldValue, StoredAudit::newValue)
				.containsExactly(tuple(null,
						"POTENTIAL_DUPLICATE_OF " + earlier.reference()));
	}

	@Test
	void relinkingWithTheSameTypeChangesNothing() {
		var earlier = fixtures.ticket(author).insert();
		var later = fixtures.ticket(author).insert();
		var first = link(later.reference(), earlier.reference(), "POTENTIAL_DUPLICATE");

		var again = link(later.reference(), earlier.reference(), "POTENTIAL_DUPLICATE");
		var fromTheOtherSide = link(earlier.reference(), later.reference(), "POTENTIAL_DUPLICATE");

		assertThat(again.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(again.getHeaders().getETag()).isEqualTo(first.getHeaders().getETag()).isEqualTo("\"1\"");
		assertThat(fromTheOtherSide.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(fromTheOtherSide.getHeaders().getETag()).isEqualTo("\"1\"");
		assertThat(row(earlier.id()).version()).isOne();
		assertThat(row(later.id()).version()).isOne();
		assertThat(audits(earlier.id())).hasSize(1);
		assertThat(audits(later.id())).hasSize(1);
		assertThat(storedLinks(earlier.id(), later.id())).hasSize(1);
	}

	@Test
	void switchingRelatedToPotentialDuplicateSwapsALinkStoredEarlierToLater() {
		var earlier = fixtures.ticket(author).insert();
		var later = fixtures.ticket(author).insert();
		var creator = fixtures.support(fixtures.team());
		fixtures.link(earlier.id(), later.id(), "RELATED", creator);

		var response = link(earlier.reference(), later.reference(), "POTENTIAL_DUPLICATE");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
		assertThat(storedLinks(earlier.id(), later.id()))
				.containsExactly(new StoredLink(later.id(), earlier.id(), "POTENTIAL_DUPLICATE", creator));
		var earlierRow = row(earlier.id());
		assertThat(earlierRow.version()).isOne();
		assertThat(row(later.id()).version()).isOne();
		assertThat(audits(earlier.id())).containsExactly(new StoredAudit(support, earlierRow.updatedAt(),
				"RELATED " + later.reference(), "HAS_POTENTIAL_DUPLICATE " + later.reference()));
		assertThat(audits(later.id())).containsExactly(new StoredAudit(support, earlierRow.updatedAt(),
				"RELATED " + earlier.reference(), "POTENTIAL_DUPLICATE_OF " + earlier.reference()));
	}

	@Test
	void switchingPotentialDuplicateToRelatedAuditsOldToNew() {
		var earlier = fixtures.ticket(author).insert();
		var later = fixtures.ticket(author).insert();
		fixtures.link(later.id(), earlier.id(), "POTENTIAL_DUPLICATE", support);

		var response = link(later.reference(), earlier.reference(), "RELATED");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(linksOf(response)).singleElement().satisfies(link -> assertThat(link)
				.containsEntry("relation", "RELATED").containsEntry("reference", earlier.reference()));
		assertThat(storedLinks(earlier.id(), later.id()))
				.containsExactly(new StoredLink(later.id(), earlier.id(), "RELATED", support));
		assertThat(audits(later.id())).extracting(StoredAudit::oldValue, StoredAudit::newValue)
				.containsExactly(tuple("POTENTIAL_DUPLICATE_OF " + earlier.reference(),
						"RELATED " + earlier.reference()));
		assertThat(audits(earlier.id())).extracting(StoredAudit::oldValue, StoredAudit::newValue)
				.containsExactly(tuple("HAS_POTENTIAL_DUPLICATE " + later.reference(),
						"RELATED " + later.reference()));
	}

	@Test
	void unlinkRemovesTheLinkFromEitherSideAndAuditsBothSides() {
		var earlier = fixtures.ticket(author).insert();
		var later = fixtures.ticket(author).insert();
		fixtures.link(later.id(), earlier.id(), "POTENTIAL_DUPLICATE", support);

		var response = unlink(earlier.reference(), later.reference());

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
		assertThat(linksOf(response)).isEmpty();
		assertThat(storedLinks(earlier.id(), later.id())).isEmpty();
		var earlierRow = row(earlier.id());
		var laterRow = row(later.id());
		assertThat(earlierRow.version()).isOne();
		assertThat(laterRow.version()).isOne();
		assertThat(audits(earlier.id())).containsExactly(new StoredAudit(support, earlierRow.updatedAt(),
				"HAS_POTENTIAL_DUPLICATE " + later.reference(), null));
		assertThat(audits(later.id())).containsExactly(new StoredAudit(support, laterRow.updatedAt(),
				"POTENTIAL_DUPLICATE_OF " + earlier.reference(), null));
	}

	@Test
	void unlinkingALinkThatDoesNotExistChangesNothing() {
		var earlier = fixtures.ticket(author).version(3).insert();
		var later = fixtures.ticket(author).insert();

		var response = unlink(earlier.reference(), later.reference());

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getHeaders().getETag()).isEqualTo("\"3\"");
		assertThat(row(earlier.id()).version()).isEqualTo(3);
		assertThat(row(later.id()).version()).isZero();
		assertThat(audits(earlier.id())).isEmpty();
		assertThat(audits(later.id())).isEmpty();
	}

	@Test
	void closedTicketsMayBeLinkedAndUnlinkedAtEitherEnd() {
		var closed = fixtures.ticket(author).closedAfter(Duration.ofMinutes(5)).insert();
		var open = fixtures.ticket(author).insert();

		var linked = link(closed.reference(), open.reference(), "RELATED");
		var unlinked = unlink(open.reference(), closed.reference());

		assertThat(linked.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(unlinked.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(unlinked.getHeaders().getETag()).isEqualTo("\"2\"");
		assertThat(storedLinks(closed.id(), open.id())).isEmpty();
		assertThat(row(closed.id()).version()).isEqualTo(2);
		assertThat(audits(closed.id())).extracting(StoredAudit::newValue)
				.containsExactly("RELATED " + open.reference(), null);
		assertThat(audits(open.id())).extracting(StoredAudit::newValue)
				.containsExactly("RELATED " + closed.reference(), null);
	}

	@Test
	void customerMayNotLinkOrUnlink() {
		var customerSession = login(fixtures.email(author), TicketFixtures.PASSWORD);
		var earlier = fixtures.ticket(author).insert();
		var later = fixtures.ticket(author).insert();
		var linkedEarlier = fixtures.ticket(author).insert();
		var linkedLater = fixtures.ticket(author).insert();
		fixtures.link(linkedLater.id(), linkedEarlier.id(), "RELATED", support);

		assertProblem(link(customerSession, earlier.reference(), later.reference(), Map.of("type", "RELATED")),
				HttpStatus.FORBIDDEN, "ticket/forbidden");
		assertProblem(unlink(customerSession, linkedEarlier.reference(), linkedLater.reference()),
				HttpStatus.FORBIDDEN, "ticket/forbidden");

		assertThat(storedLinks(earlier.id(), later.id())).isEmpty();
		assertThat(storedLinks(linkedEarlier.id(), linkedLater.id())).hasSize(1);
		assertNothingWritten(earlier, later, linkedEarlier, linkedLater);
	}

	@Test
	void customerAddressingAnotherOrganizationsTicketIsNotFound() {
		var customerSession = login(fixtures.email(author), TicketFixtures.PASSWORD);
		var own = fixtures.ticket(author).insert();
		var foreign = fixtures.ticket(fixtures.customer(fixtures.organization())).insert();

		assertNotFound(link(customerSession, foreign.reference(), own.reference(), Map.of("type", "RELATED")),
				foreign.reference());
		assertNotFound(unlink(customerSession, foreign.reference(), own.reference()), foreign.reference());
		assertNothingWritten(own, foreign);
	}

	@Test
	void missingTargetIsNotFoundNamingIt() {
		var ticket = fixtures.ticket(author).insert();

		assertNotFound(link(ticket.reference(), "RET-999999", "RELATED"), "RET-999999");
		assertNotFound(unlink(ticket.reference(), "RET-999999"), "RET-999999");
		assertNotFound(link(ticket.reference(), "abc", "RELATED"), "abc");
		assertNotFound(unlink(ticket.reference(), "abc"), "abc");
		assertNotFound(link("RET-999999", ticket.reference(), "RELATED"), "RET-999999");
		assertNotFound(unlink("RET-999999", ticket.reference()), "RET-999999");
		assertNothingWritten(ticket);
	}

	@Test
	void linkToItselfIsRefused() {
		var ticket = fixtures.ticket(author).insert();
		var lowercase = ticket.reference().toLowerCase(Locale.ROOT);

		assertValidation(link(ticket.reference(), ticket.reference(), "RELATED"),
				"linkedReference linkedReference.self");
		assertValidation(link(ticket.reference(), lowercase, "POTENTIAL_DUPLICATE"),
				"linkedReference linkedReference.self");
		assertValidation(unlink(ticket.reference(), ticket.reference()), "linkedReference linkedReference.self");
		assertValidation(unlink(lowercase, ticket.reference()), "linkedReference linkedReference.self");
		assertNothingWritten(ticket);
	}

	@Test
	void typeIsRequiredAndMustBeKnown() {
		var earlier = fixtures.ticket(author).insert();
		var later = fixtures.ticket(author).insert();

		assertValidation(link(supportSession, earlier.reference(), later.reference(), Map.of()), "type field.required");
		assertValidation(link(earlier.reference(), later.reference(), " "), "type field.required");
		assertValidation(link(earlier.reference(), later.reference(), "DUPLICATE"), "type type.unknown");
		assertValidation(link(supportSession, earlier.reference(), earlier.reference(), Map.of()),
				"type field.required", "linkedReference linkedReference.self");
		assertThat(storedLinks(earlier.id(), later.id())).isEmpty();
		assertNothingWritten(earlier, later);
	}

	@Test
	void bodyThatCannotBeReadIsMalformed() {
		var earlier = fixtures.ticket(author).insert();
		var later = fixtures.ticket(author).insert();

		assertProblem(link(supportSession, earlier.reference(), later.reference(), "{\"type\":"),
				HttpStatus.BAD_REQUEST, "malformed-request");
		assertProblem(link(supportSession, earlier.reference(), later.reference(), Map.of("type", Map.of())),
				HttpStatus.BAD_REQUEST, "malformed-request");
		assertNothingWritten(earlier, later);
	}

	@Test
	void customerSeesNeitherLinkNorEntryForAnotherOrganizationsTicket() {
		var own = fixtures.ticket(author).insert();
		var foreign = fixtures.ticket(fixtures.customer(fixtures.organization())).insert();
		assertThat(link(own.reference(), foreign.reference(), "RELATED").getStatusCode()).isEqualTo(HttpStatus.OK);
		var customerSession = login(fixtures.email(author), TicketFixtures.PASSWORD);

		var customerView = details(customerSession, own.reference());
		var supportView = details(supportSession, own.reference());
		var supportForeignView = details(supportSession, foreign.reference());

		assertThat(customerView.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(linksOf(customerView)).isEmpty();
		assertThat(linkEntries(customerView)).isEmpty();
		assertThat(linksOf(supportView)).extracting(link -> link.get("reference")).containsExactly(foreign.reference());
		assertThat(linkEntries(supportView)).containsExactly(tuple(null, "RELATED " + foreign.reference()));
		assertThat(linksOf(supportForeignView)).extracting(link -> link.get("reference"))
				.containsExactly(own.reference());
		assertThat(linkEntries(supportForeignView)).containsExactly(tuple(null, "RELATED " + own.reference()));
	}

	@Test
	void customerOfTheSameOrganizationSeesLinkEntriesOnBothTickets() {
		var organization = fixtures.organization();
		var earlier = fixtures.ticket(fixtures.customer(organization)).insert();
		var later = fixtures.ticket(fixtures.customer(organization)).insert();
		var colleague = fixtures.customer(organization);
		var customerSession = login(fixtures.email(colleague), TicketFixtures.PASSWORD);
		link(later.reference(), earlier.reference(), "POTENTIAL_DUPLICATE");

		var earlierWhileLinked = details(customerSession, earlier.reference());
		var laterWhileLinked = details(customerSession, later.reference());
		unlink(later.reference(), earlier.reference());
		var earlierAfterRemoval = details(customerSession, earlier.reference());
		var laterAfterRemoval = details(customerSession, later.reference());

		assertThat(linksOf(earlierWhileLinked)).singleElement().satisfies(link -> assertThat(link)
				.containsEntry("relation", "HAS_POTENTIAL_DUPLICATE").containsEntry("reference", later.reference()));
		assertThat(linksOf(laterWhileLinked)).singleElement().satisfies(link -> assertThat(link)
				.containsEntry("relation", "POTENTIAL_DUPLICATE_OF").containsEntry("reference", earlier.reference()));
		assertThat(linksOf(earlierAfterRemoval)).isEmpty();
		assertThat(linksOf(laterAfterRemoval)).isEmpty();
		assertThat(linkEntries(earlierAfterRemoval)).containsExactly(
				tuple(null, "HAS_POTENTIAL_DUPLICATE " + later.reference()),
				tuple("HAS_POTENTIAL_DUPLICATE " + later.reference(), null));
		assertThat(linkEntries(laterAfterRemoval)).containsExactly(
				tuple(null, "POTENTIAL_DUPLICATE_OF " + earlier.reference()),
				tuple("POTENTIAL_DUPLICATE_OF " + earlier.reference(), null));
	}

	@Test
	void switchingTheTypeOfALinkOnAClosedTicketIsAllowed() {
		var closed = fixtures.ticket(author).closedAfter(Duration.ofMinutes(5)).insert();
		var open = fixtures.ticket(author).insert();
		fixtures.link(open.id(), closed.id(), "RELATED", support);

		var response = link(closed.reference(), open.reference(), "POTENTIAL_DUPLICATE");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
		assertThat(storedLinks(closed.id(), open.id()))
				.containsExactly(new StoredLink(open.id(), closed.id(), "POTENTIAL_DUPLICATE", support));
		assertThat(audits(closed.id())).extracting(StoredAudit::oldValue, StoredAudit::newValue)
				.containsExactly(tuple("RELATED " + open.reference(), "HAS_POTENTIAL_DUPLICATE " + open.reference()));
		assertThat(row(open.id()).version()).isOne();
	}

	@Test
	void linkingAndUnlinkingWithoutACsrfTokenIsForbidden() {
		var earlier = fixtures.ticket(author).insert();
		var later = fixtures.ticket(author).insert();
		var linkedEarlier = fixtures.ticket(author).insert();
		var linkedLater = fixtures.ticket(author).insert();
		fixtures.link(linkedLater.id(), linkedEarlier.id(), "RELATED", support);

		var put = http().put()
				.uri("/api/tickets/{reference}/links/{linkedReference}", earlier.reference(), later.reference())
				.header(HttpHeaders.COOKIE, "SESSION=" + supportSession)
				.contentType(MediaType.APPLICATION_JSON)
				.body(Map.of("type", "RELATED"))
				.retrieve()
				.toEntity(JSON_OBJECT);
		var delete = http().delete()
				.uri("/api/tickets/{reference}/links/{linkedReference}", linkedEarlier.reference(),
						linkedLater.reference())
				.header(HttpHeaders.COOKIE, "SESSION=" + supportSession)
				.retrieve()
				.toEntity(JSON_OBJECT);

		assertProblem(put, HttpStatus.FORBIDDEN, "auth/forbidden");
		assertProblem(delete, HttpStatus.FORBIDDEN, "auth/forbidden");
		assertThat(storedLinks(earlier.id(), later.id())).isEmpty();
		assertThat(storedLinks(linkedEarlier.id(), linkedLater.id())).hasSize(1);
		assertNothingWritten(earlier, later, linkedEarlier, linkedLater);
	}

	@Test
	void parallelIdenticalLinksFromBothSidesStoreOneLink() throws Exception {
		var earlier = fixtures.ticket(author).insert();
		var later = fixtures.ticket(author).insert();
		var calls = new ArrayList<Callable<ResponseEntity<Map<String, Object>>>>();
		for (int i = 0; i < 8; i++) {
			var addressed = i % 2 == 0 ? earlier : later;
			var linked = addressed == earlier ? later : earlier;
			calls.add(() -> link(addressed.reference(), linked.reference(), "POTENTIAL_DUPLICATE"));
		}

		var responses = inParallel(calls);

		assertThat(responses).allSatisfy(response -> {
			assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
			assertThat(response.getHeaders().getETag()).isEqualTo("\"1\"");
		});
		assertThat(storedLinks(earlier.id(), later.id()))
				.containsExactly(new StoredLink(later.id(), earlier.id(), "POTENTIAL_DUPLICATE", support));
		assertThat(audits(earlier.id())).hasSize(1);
		assertThat(audits(later.id())).hasSize(1);
		assertThat(row(earlier.id()).version()).isOne();
		assertThat(row(later.id()).version()).isOne();
	}

	@Test
	void parallelLinkAndUnlinkNeverFail() throws Exception {
		var earlier = fixtures.ticket(author).insert();
		var later = fixtures.ticket(author).insert();
		var calls = new ArrayList<Callable<ResponseEntity<Map<String, Object>>>>();
		for (int i = 0; i < 12; i++) {
			var addressed = i % 2 == 0 ? earlier : later;
			var linked = addressed == earlier ? later : earlier;
			var type = i % 4 < 2 ? "RELATED" : "POTENTIAL_DUPLICATE";
			calls.add(i % 3 == 0 ? () -> unlink(addressed.reference(), linked.reference())
					: () -> link(addressed.reference(), linked.reference(), type));
		}

		var responses = inParallel(calls);

		assertThat(responses).allSatisfy(response -> assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK));
		for (var ticket : List.of(earlier, later)) {
			assertThat(audits(ticket.id())).hasSize((int) row(ticket.id()).version());
		}
		var lastEntry = audits(earlier.id()).getLast();
		assertThat(storedLinks(earlier.id(), later.id())).hasSize(lastEntry.newValue() == null ? 0 : 1);
	}

	private ResponseEntity<Map<String, Object>> link(String reference, String linkedReference, String type) {
		return link(supportSession, reference, linkedReference, Map.of("type", type));
	}

	private ResponseEntity<Map<String, Object>> link(String session, String reference, String linkedReference,
			Object body) {
		var csrf = primeCsrf();
		return http().put().uri("/api/tickets/{reference}/links/{linkedReference}", reference, linkedReference)
				.headers(headers -> authenticate(headers, session, csrf))
				.contentType(MediaType.APPLICATION_JSON)
				.body(body)
				.retrieve()
				.toEntity(JSON_OBJECT);
	}

	private ResponseEntity<Map<String, Object>> unlink(String reference, String linkedReference) {
		return unlink(supportSession, reference, linkedReference);
	}

	private ResponseEntity<Map<String, Object>> unlink(String session, String reference, String linkedReference) {
		var csrf = primeCsrf();
		return http().delete().uri("/api/tickets/{reference}/links/{linkedReference}", reference, linkedReference)
				.headers(headers -> authenticate(headers, session, csrf))
				.retrieve()
				.toEntity(JSON_OBJECT);
	}

	private ResponseEntity<Map<String, Object>> details(String session, String reference) {
		return http().get().uri("/api/tickets/{reference}", reference)
				.header(HttpHeaders.COOKIE, "SESSION=" + session)
				.retrieve()
				.toEntity(JSON_OBJECT);
	}

	private static List<ResponseEntity<Map<String, Object>>> inParallel(
			List<Callable<ResponseEntity<Map<String, Object>>>> calls) throws Exception {
		var start = new CountDownLatch(1);
		var responses = new ArrayList<ResponseEntity<Map<String, Object>>>();
		try (var executor = Executors.newFixedThreadPool(calls.size())) {
			var futures = calls.stream().map(call -> executor.submit(() -> {
				start.await();
				return call.call();
			})).toList();
			start.countDown();
			for (var future : futures) {
				responses.add(future.get(30, TimeUnit.SECONDS));
			}
		}
		return responses;
	}

	private static void assertProblem(ResponseEntity<Map<String, Object>> response, HttpStatus status, String type) {
		assertThat(response.getStatusCode()).isEqualTo(status);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + type);
	}

	private static void assertNotFound(ResponseEntity<Map<String, Object>> response, String reference) {
		assertProblem(response, HttpStatus.NOT_FOUND, "ticket/not-found");
		assertThat(response.getBody()).containsEntry("detail", "There is no ticket " + reference + " you can see.");
	}

	@SuppressWarnings("unchecked")
	private static void assertValidation(ResponseEntity<Map<String, Object>> response, String... fieldCodes) {
		assertProblem(response, HttpStatus.UNPROCESSABLE_CONTENT, "validation");
		assertThat((List<Map<String, Object>>) response.getBody().get("errors"))
				.extracting(error -> error.get("field") + " " + error.get("code"))
				.containsExactlyInAnyOrder(fieldCodes);
	}

	private void assertNothingWritten(TicketFixtures.Inserted... tickets) {
		for (var ticket : tickets) {
			assertThat(row(ticket.id()).version()).isZero();
			assertThat(audits(ticket.id())).isEmpty();
		}
	}

	private static void authenticate(HttpHeaders headers, String session, CsrfPair csrf) {
		headers.set("X-XSRF-TOKEN", csrf.header());
		headers.set(HttpHeaders.COOKIE, csrf.cookie() + "; SESSION=" + session);
	}

	@SuppressWarnings("unchecked")
	private static List<Map<String, Object>> linksOf(ResponseEntity<Map<String, Object>> response) {
		return (List<Map<String, Object>>) response.getBody().get("links");
	}

	@SuppressWarnings("unchecked")
	private static List<Tuple> linkEntries(ResponseEntity<Map<String, Object>> response) {
		return ((List<Map<String, Object>>) response.getBody().get("history")).stream()
				.filter(entry -> "LINK".equals(entry.get("field")))
				.map(entry -> tuple(entry.get("oldValue"), entry.get("newValue")))
				.toList();
	}

	private List<StoredLink> storedLinks(UUID one, UUID another) {
		return jdbc.sql("""
				SELECT ticket_id, linked_ticket_id, type, created_by FROM ticket_link
				WHERE (ticket_id = :one AND linked_ticket_id = :another)
				   OR (ticket_id = :another AND linked_ticket_id = :one)
				""")
				.param("one", one)
				.param("another", another)
				.query((rs, rowNum) -> new StoredLink(rs.getObject("ticket_id", UUID.class),
						rs.getObject("linked_ticket_id", UUID.class), rs.getString("type"),
						rs.getObject("created_by", UUID.class)))
				.list();
	}

	private TicketRow row(UUID ticketId) {
		return jdbc.sql("SELECT version, updated_at FROM ticket WHERE id = :id")
				.param("id", ticketId)
				.query((rs, rowNum) -> new TicketRow(rs.getLong("version"), rs.getTimestamp("updated_at").toInstant()))
				.single();
	}

	private List<StoredAudit> audits(UUID ticketId) {
		return jdbc.sql("""
				SELECT actor_id, changed_at, old_value, new_value FROM ticket_audit_entry
				WHERE ticket_id = :ticketId AND field = 'LINK'
				ORDER BY changed_at, id
				""")
				.param("ticketId", ticketId)
				.query((rs, rowNum) -> new StoredAudit(rs.getObject("actor_id", UUID.class),
						rs.getTimestamp("changed_at").toInstant(), rs.getString("old_value"),
						rs.getString("new_value")))
				.list();
	}

	private record StoredLink(UUID ticketId, UUID linkedTicketId, String type, UUID createdBy) {
	}

	private record TicketRow(long version, Instant updatedAt) {
	}

	private record StoredAudit(UUID actorId, Instant changedAt, @Nullable String oldValue,
			@Nullable String newValue) {
	}

}
