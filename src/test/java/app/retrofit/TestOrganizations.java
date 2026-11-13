package app.retrofit;

import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

import org.springframework.jdbc.core.simple.JdbcClient;

/// Creates organizations and teams for server suites and moves [TestUsers] accounts into them, always through the
/// real schema: a customer moves to another organization, support staff to another team.
public final class TestOrganizations {

	private final JdbcClient jdbc;

	public TestOrganizations(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/// An organization named `namePrefix` plus a random token.
	public UUID createOrganization(String namePrefix, int slaMinutes) {
		var id = UUID.randomUUID();
		jdbc.sql("""
				INSERT INTO organization (id, name, first_response_sla_minutes, created_at, updated_at)
				VALUES (:id, :name, :slaMinutes, now(), now())
				""")
				.param("id", id)
				.param("name", namePrefix + token())
				.param("slaMinutes", slaMinutes)
				.update();
		return id;
	}

	/// A team named `namePrefix` plus a random token.
	public UUID createTeam(String namePrefix) {
		var id = UUID.randomUUID();
		jdbc.sql("""
				INSERT INTO team (id, name, description, created_at, updated_at)
				VALUES (:id, :name, 'Test team.', now(), now())
				""")
				.param("id", id)
				.param("name", namePrefix + token())
				.update();
		return id;
	}

	public void moveCustomer(UUID userId, UUID organizationId) {
		jdbc.sql("UPDATE app_user SET organization_id = :organizationId, updated_at = now() WHERE id = :userId")
				.param("organizationId", organizationId)
				.param("userId", userId)
				.update();
	}

	public void moveSupport(UUID userId, UUID teamId) {
		jdbc.sql("UPDATE app_user SET team_id = :teamId, updated_at = now() WHERE id = :userId")
				.param("teamId", teamId)
				.param("userId", userId)
				.update();
	}

	private static String token() {
		return HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
	}

}
