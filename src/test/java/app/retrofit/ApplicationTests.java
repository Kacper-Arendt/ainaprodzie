package app.retrofit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;

class ApplicationTests extends RandomPortContext {

	@Autowired
	Clock clock;

	@AfterEach
	void cleanUp() {
		jdbc.sql("DELETE FROM app_user WHERE email LIKE '%@x.test'").update();
		jdbc.sql("DELETE FROM organization WHERE name = 'x.test'").update();
	}

	@Test
	void contextLoadsWithUtcClock() {
		assertThat(clock.getZone()).isEqualTo(ZoneOffset.UTC);
	}

	@Test
	void healthIsPublicAndUp() {
		var response = http().get().uri("/actuator/health").retrieve()
				.toEntity(new ParameterizedTypeReference<Map<String, Object>>() {
				});

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody()).containsEntry("status", "UP");
	}

	@Test
	void livenessAndReadinessProbesArePublicAndUp() {
		for (String probe : List.of("/actuator/health/liveness", "/actuator/health/readiness")) {
			var response = http().get().uri(probe).retrieve()
					.toEntity(new ParameterizedTypeReference<Map<String, Object>>() {
					});

			assertThat(response.getStatusCode()).as("status of %s", probe).isEqualTo(HttpStatus.OK);
			assertThat(response.getBody()).as("body of %s", probe).containsEntry("status", "UP");
		}
	}

	@Test
	void schemaChangesetsRunButDevSeedDoesNotUnderTestProfile() {
		var ids = jdbc.sql("SELECT id FROM databasechangelog").query(String.class).list();

		assertThat(ids).contains("db-202610071200-spring-session", "db-202610071201-app-user")
				.doesNotContain("db-202610071202-dev-seed-users");
	}

	@Test
	void seededAccountsAreAbsentUnderTestProfile() {
		var count = jdbc.sql("SELECT count(*) FROM app_user WHERE email IN ('user@example.com', 'support@example.com')")
				.query(Long.class).single();

		assertThat(count).isZero();
	}

	@Test
	void schemaConstraintsRejectInvalidUsers() {
		var organization = insertOrganization();

		assertThatThrownBy(() -> insertUser("admin@x.test", "{ADMIN}", "en", organization))
				.isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("app_user_roles_check");
		assertThatThrownBy(() -> insertUser("empty@x.test", "{}", "en", organization))
				.isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("app_user_roles_check");
		assertThatThrownBy(() -> insertUser("german@x.test", "{USER}", "de", organization))
				.isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("app_user_language_check");

		insertUser("user@x.test", "{USER}", "en", organization);
		assertThatThrownBy(() -> insertUser("USER@x.test", "{USER}", "en", organization))
				.isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("app_user_email_lower_ux");
	}

	private UUID insertOrganization() {
		var id = UUID.randomUUID();
		jdbc.sql("""
				INSERT INTO organization (id, name, first_response_sla_minutes, created_at, updated_at)
				VALUES (:id, 'x.test', 60, now(), now())
				""").param("id", id).update();
		return id;
	}

	private void insertUser(String email, String roles, String language, UUID organization) {
		jdbc.sql("""
				INSERT INTO app_user (id, email, display_name, password_hash, roles, organization_id, language,
				                      created_at, updated_at)
				VALUES (:id, :email, 'Test', '{noop}x', CAST(:roles AS text[]), :organization, :language, now(), now())
				""")
				.param("id", UUID.randomUUID())
				.param("email", email)
				.param("roles", roles)
				.param("organization", organization)
				.param("language", language)
				.update();
	}

}
