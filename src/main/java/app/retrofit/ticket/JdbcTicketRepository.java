package app.retrofit.ticket;

import java.sql.Timestamp;
import java.sql.Types;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.jspecify.annotations.Nullable;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import app.retrofit.organization.Caller;

/// The SQL of [TicketCommands]: its writes, and the reads it makes once [TicketQueries] has shown the caller may see
/// the ticket (the pair's link, the chosen team and assignee). Reads that depend on what the caller may see stay in
/// [TicketQueries] (ADR 0001).
@Repository
class JdbcTicketRepository {

	private final JdbcClient jdbc;

	JdbcTicketRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/// Opens a ticket in the author's organization: NEW, NORMAL, untriaged, version 0. Returns its number.
	long insert(UUID id, Caller.Customer author, String title, String description, @Nullable String category,
			Instant now) {
		return jdbc.sql("""
				INSERT INTO ticket (id, title, description, organization_id, author_id, category, priority, status,
				                    created_at, updated_at, version)
				VALUES (:id, :title, :description, :organizationId, :authorId, :category, :priority, :status,
				        :now, :now, 0)
				RETURNING number
				""")
				.param("id", id)
				.param("title", title)
				.param("description", description)
				.param("organizationId", author.organizationId())
				.param("authorId", author.id())
				.param("category", category, Types.VARCHAR)
				.param("priority", TicketPriority.NORMAL.name())
				.param("status", TicketStatus.NEW.name())
				.param("now", Timestamp.from(now))
				.query(Long.class)
				.single();
	}

	/// Stores `after` over `before` and raises the version, unless the ticket's version has moved past `before`'s.
	/// Returns whether it wrote.
	boolean update(Ticket before, Ticket after, Instant now) {
		return jdbc.sql("""
				UPDATE ticket
				SET title = :title, description = :description, status = :status, resolution = :resolution,
				    priority = :priority, category = :category, team_id = :teamId, assignee_id = :assigneeId,
				    first_response_at = :firstResponseAt, closed_at = :closedAt,
				    updated_at = :now, version = version + 1
				WHERE id = :id AND version = :expected
				""")
				.param("title", after.title())
				.param("description", after.description())
				.param("status", after.status().name())
				.param("resolution", after.resolution(), Types.VARCHAR)
				.param("priority", after.priority().name())
				.param("category", Ticket.nameOf(after.category()), Types.VARCHAR)
				.param("teamId", Ticket.idOf(after.team()), Types.OTHER)
				.param("assigneeId", Ticket.idOf(after.assignee()), Types.OTHER)
				.param("firstResponseAt", timestamp(after.firstResponseAt()), Types.TIMESTAMP)
				.param("closedAt", timestamp(after.closedAt()), Types.TIMESTAMP)
				.param("now", Timestamp.from(now))
				.param("id", before.id())
				.param("expected", before.version())
				.update() == 1;
	}

	void insertComment(UUID id, UUID ticketId, UUID authorId, boolean internal, String body, Instant createdAt) {
		jdbc.sql("""
				INSERT INTO ticket_comment (id, ticket_id, author_id, internal, body, created_at)
				VALUES (:id, :ticketId, :authorId, :internal, :body, :createdAt)
				""")
				.param("id", id)
				.param("ticketId", ticketId)
				.param("authorId", authorId)
				.param("internal", internal)
				.param("body", body)
				.param("createdAt", Timestamp.from(createdAt))
				.update();
	}

	void audit(UUID ticketId, UUID actorId, Instant changedAt, List<Ticket.Change> changes) {
		for (var change : changes) {
			jdbc.sql("""
					INSERT INTO ticket_audit_entry (id, ticket_id, actor_id, changed_at, field, old_value, new_value)
					VALUES (:id, :ticketId, :actorId, :changedAt, :field, :oldValue, :newValue)
					""")
					.param("id", UUID.randomUUID())
					.param("ticketId", ticketId)
					.param("actorId", actorId)
					.param("changedAt", Timestamp.from(changedAt))
					.param("field", change.field().name())
					.param("oldValue", change.oldValue(), Types.VARCHAR)
					.param("newValue", change.newValue(), Types.VARCHAR)
					.update();
		}
	}

	/// Locks both tickets in the database's own uuid order, the one lock order of every link command, so commands on
	/// one pair serialize instead of deadlocking. `UUID.compareTo` orders differently, so the order is left to the
	/// database.
	void lockPair(UUID one, UUID another) {
		jdbc.sql("SELECT id FROM ticket WHERE id IN (:one, :another) ORDER BY id FOR UPDATE")
				.param("one", one)
				.param("another", another)
				.query(UUID.class)
				.list();
	}

	/// The link between two tickets, whichever it is stored from. Every link writer holds both locks to change it.
	Optional<StoredLink> findLink(UUID one, UUID another) {
		return jdbc.sql("""
				SELECT id, ticket_id, type FROM ticket_link
				WHERE least(ticket_id, linked_ticket_id) = least(:one, :another)
				  AND greatest(ticket_id, linked_ticket_id) = greatest(:one, :another)
				""")
				.param("one", one)
				.param("another", another)
				.query((rs, rowNum) -> new StoredLink(rs.getObject("id", UUID.class),
						rs.getObject("ticket_id", UUID.class), LinkType.valueOf(rs.getString("type"))))
				.optional();
	}

	/// Returns whether it inserted; a link already stored between the pair is left as it is.
	boolean insertLink(UUID later, UUID earlier, LinkType type, UUID createdBy, Instant now) {
		return jdbc.sql("""
				INSERT INTO ticket_link (id, ticket_id, linked_ticket_id, type, created_by, created_at)
				VALUES (:id, :later, :earlier, :type, :createdBy, :now)
				ON CONFLICT DO NOTHING
				""")
				.param("id", UUID.randomUUID())
				.param("later", later)
				.param("earlier", earlier)
				.param("type", type.name())
				.param("createdBy", createdBy)
				.param("now", Timestamp.from(now))
				.update() == 1;
	}

	/// Switches a link's type and stores it from `later` to `earlier`.
	void updateLink(UUID id, LinkType type, UUID later, UUID earlier) {
		jdbc.sql("UPDATE ticket_link SET type = :type, ticket_id = :later, linked_ticket_id = :earlier WHERE id = :id")
				.param("type", type.name())
				.param("later", later)
				.param("earlier", earlier)
				.param("id", id)
				.update();
	}

	void deleteLink(UUID id) {
		jdbc.sql("DELETE FROM ticket_link WHERE id = :id").param("id", id).update();
	}

	/// Raises both tickets' version and last-update time without a version check: a link change is last-write-wins
	/// (ADR 0003).
	void touchPair(UUID one, UUID another, Instant now) {
		jdbc.sql("UPDATE ticket SET version = version + 1, updated_at = :now WHERE id IN (:one, :another)")
				.param("now", Timestamp.from(now))
				.param("one", one)
				.param("another", another)
				.update();
	}

	Optional<NamedRef> findTeam(UUID id) {
		return jdbc.sql("SELECT id, name FROM team WHERE id = :id")
				.param("id", id)
				.query((rs, rowNum) -> new NamedRef(rs.getObject("id", UUID.class), rs.getString("name")))
				.optional();
	}

	Optional<SupportAccount> findSupportAccount(UUID id) {
		return jdbc.sql("""
				SELECT display_name, enabled, team_id FROM app_user
				WHERE id = :id AND 'SUPPORT' = ANY (roles)
				""")
				.param("id", id)
				.query((rs, rowNum) -> new SupportAccount(new NamedRef(id, rs.getString("display_name")),
						rs.getBoolean("enabled"), rs.getObject("team_id", UUID.class)))
				.optional();
	}

	private static @Nullable Timestamp timestamp(@Nullable Instant instant) {
		return instant == null ? null : Timestamp.from(instant);
	}

	/// A pair's link as stored: `ticketId` is the ticket it is stored from.
	record StoredLink(UUID id, UUID ticketId, LinkType type) {
	}

	record SupportAccount(NamedRef ref, boolean enabled, @Nullable UUID teamId) {
	}

}
