package app.retrofit.ticket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Timestamp;
import java.sql.Types;
import java.time.Instant;
import java.util.UUID;

import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.annotation.Transactional;

import app.retrofit.RandomPortContext;

/// Constraints of the audit, idempotency and link tables that ticket writes rely on, exercised with real inserts.
@Transactional
class TicketWriteSchemaTests extends RandomPortContext {

	@Test
	void auditEntryForTicketCreationIsAccepted() {
		var fixtures = new TicketFixtures(jdbc);
		var author = fixtures.customer(fixtures.organization());
		var ticket = fixtures.ticket(author).title("Cannot log in").insert();

		fixtures.audit(ticket.id(), author, ticket.createdAt(), "CREATED", null, "Cannot log in");

		assertThat(jdbc.sql("SELECT new_value FROM ticket_audit_entry WHERE ticket_id = :id AND field = 'CREATED'")
				.param("id", ticket.id())
				.query(String.class)
				.single()).isEqualTo("Cannot log in");
	}

	@Test
	void idempotencyKeyIsUniquePerUser() {
		var fixtures = new TicketFixtures(jdbc);
		var user = fixtures.customer(fixtures.organization());
		insertKey(user, "retry-1", null);

		assertThatThrownBy(() -> insertKey(user, "retry-1", null))
				.isInstanceOf(DataIntegrityViolationException.class)
				.hasMessageContaining("idempotency_key_pkey");
	}

	@Test
	void idempotencyKeyForUnknownTicketIsRejected() {
		var fixtures = new TicketFixtures(jdbc);
		var user = fixtures.customer(fixtures.organization());

		assertThatThrownBy(() -> insertKey(user, "retry-1", UUID.randomUUID()))
				.isInstanceOf(DataIntegrityViolationException.class)
				.hasMessageContaining("idempotency_key_ticket_fk");
	}

	@Test
	void secondLinkOfAPairInEitherDirectionIsRejected() {
		var fixtures = new TicketFixtures(jdbc);
		var author = fixtures.customer(fixtures.organization());
		var support = fixtures.support(fixtures.team());
		var earlier = fixtures.ticket(author).insert();
		var later = fixtures.ticket(author).insert();
		fixtures.link(later.id(), earlier.id(), "POTENTIAL_DUPLICATE", support);

		assertThatThrownBy(() -> fixtures.link(earlier.id(), later.id(), "RELATED", support))
				.isInstanceOf(DataIntegrityViolationException.class)
				.hasMessageContaining("ticket_link_pair_ux");
	}

	private void insertKey(UUID userId, String key, @Nullable UUID ticketId) {
		jdbc.sql("""
				INSERT INTO idempotency_key (user_id, key, request_hash, ticket_id, comment_id, response_status,
				                             created_at)
				VALUES (:userId, :key, 'hash', :ticketId, NULL, NULL, :createdAt)
				""")
				.param("userId", userId)
				.param("key", key)
				.param("ticketId", ticketId, Types.OTHER)
				.param("createdAt", Timestamp.from(Instant.now()))
				.update();
	}

}
