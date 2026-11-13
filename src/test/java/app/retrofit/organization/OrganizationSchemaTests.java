package app.retrofit.organization;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Types;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

import app.retrofit.RandomPortContext;
import app.retrofit.TestOrganizations;

/// Constraints of the organization and team tables that the endpoints rely on, exercised with real inserts.
class OrganizationSchemaTests extends RandomPortContext {

	@Test
	void customerWithUnknownOrganizationIsRejected() {
		assertThatThrownBy(() -> jdbc.sql("""
				INSERT INTO app_user (id, email, display_name, password_hash, roles, organization_id, language,
				                      created_at, updated_at)
				VALUES (:id, :email, 'Test', '{noop}x', ARRAY['USER']::text[], :organizationId, 'en', now(), now())
				""")
				.param("id", UUID.randomUUID())
				.param("email", "orphan-" + token() + "@x.test")
				.param("organizationId", UUID.randomUUID())
				.update())
				.isInstanceOf(DataIntegrityViolationException.class)
				.hasMessageContaining("app_user_organization_fk");
	}

	@Test
	void organizationWithoutPositiveSlaIsRejected() {
		assertThatThrownBy(() -> insertOrganization("zero-" + token(), 0))
				.isInstanceOf(DataIntegrityViolationException.class)
				.hasMessageContaining("organization_sla_positive_check");
		assertThatThrownBy(() -> insertOrganization("negative-" + token(), -1))
				.isInstanceOf(DataIntegrityViolationException.class)
				.hasMessageContaining("organization_sla_positive_check");
		assertThatThrownBy(() -> insertOrganization("missing-" + token(), null))
				.isInstanceOf(DataIntegrityViolationException.class)
				.hasMessageContaining("first_response_sla_minutes");
	}

	@Test
	void organizationAndTeamNamesAreUnique() {
		var organizationName = "Acme-" + token();
		insertOrganization(organizationName, 60);
		assertThatThrownBy(() -> insertOrganization(organizationName, 60))
				.isInstanceOf(DataIntegrityViolationException.class)
				.hasMessageContaining("organization_name_ux");

		var teams = new TestOrganizations(jdbc);
		var teamId = teams.createTeam("Helpdesk-");
		var teamName = jdbc.sql("SELECT name FROM team WHERE id = :id").param("id", teamId).query(String.class).single();
		assertThatThrownBy(() -> jdbc.sql("""
				INSERT INTO team (id, name, description, created_at, updated_at)
				VALUES (:id, :name, 'Test team.', now(), now())
				""").param("id", UUID.randomUUID()).param("name", teamName).update())
				.isInstanceOf(DataIntegrityViolationException.class)
				.hasMessageContaining("team_name_ux");
	}

	private void insertOrganization(String name, @Nullable Integer slaMinutes) {
		jdbc.sql("""
				INSERT INTO organization (id, name, first_response_sla_minutes, created_at, updated_at)
				VALUES (:id, :name, :sla, now(), now())
				""")
				.param("id", UUID.randomUUID())
				.param("name", name)
				.param("sla", slaMinutes, Types.INTEGER)
				.update();
	}

	private static String token() {
		return HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
	}

}
