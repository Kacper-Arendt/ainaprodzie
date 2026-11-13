package app.retrofit.ticket;

import java.sql.Timestamp;
import java.sql.Types;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

import org.jspecify.annotations.Nullable;
import org.springframework.jdbc.core.simple.JdbcClient;

/// Inserts organizations, teams, accounts and tickets straight into the schema for read and write suites. Names carry
/// a random suffix, so suites sharing the test database never collide on unique names.
final class TicketFixtures {

	/// Every fixture account signs in with this password (`{noop}` hash, which the delegating encoder accepts).
	static final String PASSWORD = "x";

	private final JdbcClient jdbc;

	TicketFixtures(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	UUID organization(Duration firstResponseSla) {
		var id = UUID.randomUUID();
		jdbc.sql("""
				INSERT INTO organization (id, name, first_response_sla_minutes, created_at, updated_at)
				VALUES (:id, :name, :sla, now(), now())
				""").param("id", id).param("name", "Organization " + suffix()).param("sla", firstResponseSla.toMinutes())
				.update();
		return id;
	}

	UUID organization() {
		return organization(Duration.ofHours(4));
	}

	UUID team() {
		var id = UUID.randomUUID();
		jdbc.sql("""
				INSERT INTO team (id, name, description, created_at, updated_at)
				VALUES (:id, :name, 'Test team', now(), now())
				""").param("id", id).param("name", "Team " + suffix()).update();
		return id;
	}

	UUID customer(UUID organizationId) {
		return user("USER", organizationId, null);
	}

	UUID support(UUID teamId) {
		return user("SUPPORT", null, teamId);
	}

	/// A second enabled support account in `teamId` with the display name of `supportId`; display names are not unique.
	UUID namesake(UUID supportId, UUID teamId) {
		var id = support(teamId);
		jdbc.sql("UPDATE app_user SET display_name = :name WHERE id = :id").param("name", displayName(supportId))
				.param("id", id).update();
		return id;
	}

	/// A support account that can no longer sign in or be assigned, still a member of `teamId`.
	UUID disabledSupport(UUID teamId) {
		var id = support(teamId);
		jdbc.sql("UPDATE app_user SET enabled = false WHERE id = :id").param("id", id).update();
		return id;
	}

	/// Moves a support account into another team; a support member belongs to exactly one team.
	void joinTeam(UUID supportId, UUID teamId) {
		jdbc.sql("UPDATE app_user SET team_id = :teamId WHERE id = :id").param("teamId", teamId).param("id", supportId)
				.update();
	}

	/// The sign-in email of a fixture account, for [app.retrofit.RandomPortContext#login] with [#PASSWORD].
	String email(UUID userId) {
		return jdbc.sql("SELECT email FROM app_user WHERE id = :id").param("id", userId).query(String.class).single();
	}

	/// The display name audit entries record for an assignee.
	String displayName(UUID userId) {
		return jdbc.sql("SELECT display_name FROM app_user WHERE id = :id").param("id", userId).query(String.class)
				.single();
	}

	/// The name audit entries record for a team.
	String teamName(UUID teamId) {
		return jdbc.sql("SELECT name FROM team WHERE id = :id").param("id", teamId).query(String.class).single();
	}

	NewTicket ticket(UUID authorId) {
		return new NewTicket(authorId);
	}

	void comment(UUID ticketId, UUID authorId, boolean internal, String body, Instant createdAt) {
		jdbc.sql("""
				INSERT INTO ticket_comment (id, ticket_id, author_id, internal, body, created_at)
				VALUES (:id, :ticketId, :authorId, :internal, :body, :createdAt)
				""")
				.param("id", UUID.randomUUID())
				.param("ticketId", ticketId)
				.param("authorId", authorId)
				.param("internal", internal)
				.param("body", body)
				.param("createdAt", Timestamp.from(createdAt))
				.update();
	}

	void link(UUID ticketId, UUID linkedTicketId, String type, UUID createdBy) {
		jdbc.sql("""
				INSERT INTO ticket_link (id, ticket_id, linked_ticket_id, type, created_by, created_at)
				VALUES (:id, :ticketId, :linkedTicketId, :type, :createdBy, now())
				""")
				.param("id", UUID.randomUUID())
				.param("ticketId", ticketId)
				.param("linkedTicketId", linkedTicketId)
				.param("type", type)
				.param("createdBy", createdBy)
				.update();
	}

	void audit(UUID ticketId, UUID actorId, Instant changedAt, String field, @Nullable String oldValue,
			@Nullable String newValue) {
		jdbc.sql("""
				INSERT INTO ticket_audit_entry (id, ticket_id, actor_id, changed_at, field, old_value, new_value)
				VALUES (:id, :ticketId, :actorId, :changedAt, :field, :oldValue, :newValue)
				""")
				.param("id", UUID.randomUUID())
				.param("ticketId", ticketId)
				.param("actorId", actorId)
				.param("changedAt", Timestamp.from(changedAt))
				.param("field", field)
				.param("oldValue", oldValue, Types.VARCHAR)
				.param("newValue", newValue, Types.VARCHAR)
				.update();
	}

	private UUID user(String role, @Nullable UUID organizationId, @Nullable UUID teamId) {
		var id = UUID.randomUUID();
		var suffix = suffix();
		jdbc.sql("""
				INSERT INTO app_user (id, email, display_name, password_hash, roles, organization_id, team_id, language,
				                      created_at, updated_at)
				VALUES (:id, :email, :displayName, :passwordHash, ARRAY[:role]::text[], :organizationId, :teamId, 'en',
				        now(), now())
				""")
				.param("id", id)
				.param("email", "person-" + suffix + "@tickets.test")
				.param("displayName", "Person " + suffix)
				.param("passwordHash", "{noop}" + PASSWORD)
				.param("role", role)
				.param("organizationId", organizationId, Types.OTHER)
				.param("teamId", teamId, Types.OTHER)
				.update();
		return id;
	}

	private static String suffix() {
		return HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
	}

	/// A ticket by a customer of its organization, created an hour ago, untriaged, unanswered and open unless told
	/// otherwise.
	final class NewTicket {

		private final UUID authorId;

		private String title = "Ticket " + suffix();

		private String description = "Something does not work.";

		private String status = "NEW";

		private String priority = "NORMAL";

		private @Nullable String category;

		private @Nullable UUID teamId;

		private @Nullable UUID assigneeId;

		private @Nullable String resolution;

		private Instant createdAt = Instant.now().minus(1, ChronoUnit.HOURS).truncatedTo(ChronoUnit.MICROS);

		private @Nullable Instant firstResponseAt;

		private @Nullable Instant closedAt;

		private @Nullable Instant updatedAt;

		private long version;

		private NewTicket(UUID authorId) {
			this.authorId = authorId;
		}

		NewTicket title(String title) {
			this.title = title;
			return this;
		}

		NewTicket description(String description) {
			this.description = description;
			return this;
		}

		NewTicket status(String status) {
			this.status = status;
			return this;
		}

		NewTicket priority(String priority) {
			this.priority = priority;
			return this;
		}

		NewTicket category(String category) {
			this.category = category;
			return this;
		}

		NewTicket team(UUID teamId) {
			this.teamId = teamId;
			return this;
		}

		NewTicket assignee(UUID assigneeId) {
			this.assigneeId = assigneeId;
			return this;
		}

		NewTicket resolution(String resolution) {
			this.resolution = resolution;
			return this;
		}

		NewTicket createdAgo(Duration age) {
			this.createdAt = Instant.now().minus(age).truncatedTo(ChronoUnit.MICROS);
			return this;
		}

		NewTicket answeredAfter(Duration waitingTime) {
			this.firstResponseAt = createdAt.plus(waitingTime);
			return this;
		}

		NewTicket closedAfter(Duration age) {
			this.status = "CLOSED";
			this.closedAt = createdAt.plus(age);
			return this;
		}

		NewTicket updatedAgo(Duration age) {
			this.updatedAt = Instant.now().minus(age).truncatedTo(ChronoUnit.MICROS);
			return this;
		}

		NewTicket version(long version) {
			this.version = version;
			return this;
		}

		Inserted insert() {
			var id = UUID.randomUUID();
			var number = jdbc.sql("""
					INSERT INTO ticket (id, title, description, organization_id, author_id, category, priority, status,
					                    team_id, assignee_id, resolution, created_at, updated_at, first_response_at, closed_at,
					                    version)
					SELECT :id, :title, :description, organization_id, id, :category, :priority, :status, :teamId,
					       :assigneeId, :resolution, :createdAt, :updatedAt, :firstResponseAt, :closedAt, :version
					FROM app_user WHERE id = :authorId
					RETURNING number
					""")
					.param("id", id)
					.param("title", title)
					.param("description", description)
					.param("category", category, Types.VARCHAR)
					.param("priority", priority)
					.param("status", status)
					.param("teamId", teamId, Types.OTHER)
					.param("assigneeId", assigneeId, Types.OTHER)
					.param("resolution", resolution, Types.VARCHAR)
					.param("createdAt", Timestamp.from(createdAt))
					.param("updatedAt", Timestamp.from(updatedAt == null ? createdAt : updatedAt))
					.param("firstResponseAt", firstResponseAt == null ? null : Timestamp.from(firstResponseAt),
							Types.TIMESTAMP)
					.param("closedAt", closedAt == null ? null : Timestamp.from(closedAt), Types.TIMESTAMP)
					.param("version", version)
					.param("authorId", authorId)
					.query(Long.class)
					.single();
			return new Inserted(id, "RET-" + number, createdAt);
		}

	}

	record Inserted(UUID id, String reference, Instant createdAt) {
	}

}
