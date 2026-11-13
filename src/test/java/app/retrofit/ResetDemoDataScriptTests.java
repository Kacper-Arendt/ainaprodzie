package app.retrofit;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.client.RestClient.RequestBodySpec;
import org.springframework.web.client.RestClient.RequestBodyUriSpec;
import org.testcontainers.containers.PostgreSQLContainer;

/// `scripts/reset-demo-data` against a database Liquibase seeded under the `dev` context, after the real API changed
/// it. The extra context gives this suite an application context, and so a container, of its own: the shared test
/// database carries no demo data, and a reset restarts the ticket numbers, which would collide with the tickets other
/// suites keep there.
@TestPropertySource(properties = "spring.liquibase.contexts=schema,dev")
class ResetDemoDataScriptTests extends RandomPortContext {

	private static final ParameterizedTypeReference<Map<String, Object>> JSON_OBJECT = new ParameterizedTypeReference<>() {
	};

	@Autowired
	PostgreSQLContainer<?> postgres;

	@Test
	void resetRestoresTheSeedAfterTheApiChangedItAndTheNextTicketIsRet1051() throws Exception {
		var initial = snapshot();
		assertThat(initial.get("tickets")).isEqualTo("1001-1050");
		var customer = login("user@example.com", "password");
		var support = login("support@example.com", "password");

		var created = post(customer, "/api/tickets", Map.of("title", "Added by a participant"), "create-key");
		assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(post(support, "/api/tickets/RET-1001/comments", Map.of("body", "Added later"), "comment-key")
				.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(put(support, "/api/tickets/RET-1051/links/RET-1001", Map.of("type", "RELATED")).getStatusCode()
				.is2xxSuccessful()).isTrue();
		jdbc.sql("UPDATE app_user SET language = 'pl', enabled = false WHERE email = 'user@example.com'").update();
		jdbc.sql("UPDATE app_user SET display_name = 'Renamed' WHERE email = 'support@example.com'").update();
		assertThat(snapshot()).isNotEqualTo(initial);

		var output = reset();

		assertThat(output).contains("RET-1001").contains("RET-1050");
		assertThat(snapshot()).isEqualTo(initial);
		assertThat(jdbc.sql("SELECT count(*) FROM idempotency_key").query(Long.class).single()).isZero();
		var next = post(login("user@example.com", "password"), "/api/tickets", Map.of("title", "After the reset"), null);
		assertThat(next.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(reference(next)).isEqualTo("RET-1051");
	}

	@Test
	void accountsAddedToADemoTeamOrOrganizationKeepItThroughTheResetAndSessionsSurvive() throws Exception {
		reset();
		addAccountLike("support@example.com", "jane.doe@example.com", "SUPPORT");
		addAccountLike("user@example.com", "john.roe@example.com", "USER");
		var initial = snapshot();
		var customer = login("john.roe@example.com", "password");
		var support = login("support@example.com", "password");
		var raised = post(customer, "/api/tickets", Map.of("title", "Raised by an added customer"), "added-key");
		assertThat(raised.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(post(login("jane.doe@example.com", "password"), "/api/tickets/" + reference(raised)
				+ "/comments", Map.of("body", "Answered by added support staff"), null).getStatusCode())
				.isEqualTo(HttpStatus.CREATED);

		reset();

		assertThat(snapshot()).isEqualTo(initial);
		assertThat(affiliation("jane.doe@example.com")).isEqualTo(affiliation("support@example.com"));
		assertThat(affiliation("john.roe@example.com")).isEqualTo(affiliation("user@example.com"));
		for (var session : List.of(customer, support)) {
			var stillSignedIn = http().get().uri("/api/auth/session").header(HttpHeaders.COOKIE, "SESSION=" + session)
					.retrieve().toBodilessEntity();
			assertThat(stillSignedIn.getStatusCode()).isEqualTo(HttpStatus.OK);
		}
	}

	@Test
	void resetRefusesWhileTicketsOutsideTheDemoOrganizationsExist() throws Exception {
		var organization = UUID.randomUUID();
		var customer = UUID.randomUUID();
		var ticket = UUID.randomUUID();
		jdbc.sql("""
				INSERT INTO organization (id, name, first_response_sla_minutes, created_at, updated_at)
				VALUES (:id, 'Added organization', 60, now(), now())""").param("id", organization).update();
		jdbc.sql("""
				INSERT INTO app_user (id, email, display_name, password_hash, roles, organization_id, language,
				                      created_at, updated_at)
				VALUES (:id, 'added@added.example', 'Added Customer', '{noop}x', ARRAY['USER']::text[], :organization,
				        'en', now(), now())""").param("id", customer).param("organization", organization).update();
		jdbc.sql("""
				INSERT INTO ticket (id, title, description, organization_id, author_id, created_at, updated_at)
				VALUES (:id, 'Outside the demo', '', :organization, :author, now(), now())""")
				.param("id", ticket).param("organization", organization).param("author", customer).update();
		var before = snapshot();
		try {
			var refused = run();

			assertThat(refused.exitCode()).isNotZero();
			assertThat(refused.output()).contains("outside the demo organizations");
			assertThat(snapshot()).isEqualTo(before);
		}
		finally {
			jdbc.sql("DELETE FROM ticket WHERE id = :id").param("id", ticket).update();
			jdbc.sql("DELETE FROM app_user WHERE id = :id").param("id", customer).update();
			jdbc.sql("DELETE FROM organization WHERE id = :id").param("id", organization).update();
			// The insert took a ticket number; the reset restarts them for the other tests.
			reset();
		}
	}

	/// Row counts and identity of the demo data, without the timestamps the seed derives from `now()`.
	private Map<String, String> snapshot() {
		var result = new HashMap<String, String>();
		result.put("tickets", jdbc.sql("SELECT min(number) || '-' || max(number) FROM ticket").query(String.class)
				.single());
		for (var table : List.of("organization", "team", "app_user", "ticket", "ticket_comment", "ticket_link",
				"ticket_audit_entry")) {
			result.put(table, jdbc.sql("SELECT count(*) FROM " + table).query(Long.class).single().toString());
		}
		result.put("accounts", jdbc.sql("""
				SELECT string_agg(email || display_name || language || enabled, ',' ORDER BY email) FROM app_user""")
				.query(String.class).single());
		result.put("states", jdbc.sql("""
				SELECT string_agg(number || status || version, ',' ORDER BY number) FROM ticket""")
				.query(String.class).single());
		return result;
	}

	/// Inserts an account in the demo team or organization of `template`, as README's "Creating a user" does.
	private void addAccountLike(String template, String email, String role) {
		jdbc.sql("""
				INSERT INTO app_user (id, email, display_name, password_hash, roles, organization_id, team_id, language,
				                      created_at, updated_at)
				SELECT gen_random_uuid(), :email, :email, password_hash, ARRAY[:role]::text[], organization_id, team_id,
				       'en', now(), now()
				FROM app_user WHERE email = :template""")
				.param("email", email).param("role", role).param("template", template)
				.update();
	}

	/// The team of a support account or the organization of a customer.
	private UUID affiliation(String email) {
		return jdbc.sql("SELECT coalesce(team_id, organization_id) FROM app_user WHERE email = :email")
				.param("email", email).query(UUID.class).single();
	}

	private String reset() throws IOException, InterruptedException {
		var result = run();
		assertThat(result.exitCode()).as(result.output()).isZero();
		return result.output();
	}

	/// Runs the script against this suite's container instead of the compose one.
	private ScriptResult run() throws IOException, InterruptedException {
		var process = new ProcessBuilder(Path.of("scripts", "reset-demo-data").toAbsolutePath().toString())
				.redirectErrorStream(true);
		process.environment().put("RESET_DEMO_DATA_PSQL", "docker exec -i %s psql -U %s -d %s"
				.formatted(postgres.getContainerId(), postgres.getUsername(), postgres.getDatabaseName()));
		var started = process.start();
		var output = new String(started.getInputStream().readAllBytes());
		return new ScriptResult(started.waitFor(), output);
	}

	private ResponseEntity<Map<String, Object>> post(String session, String uri, Map<String, ?> body,
			@Nullable String key) {
		var request = signedIn(http().post(), session, uri).body(body);
		if (key != null) {
			request.header("Idempotency-Key", UUID.nameUUIDFromBytes(key.getBytes()).toString());
		}
		return request.retrieve().toEntity(JSON_OBJECT);
	}

	private ResponseEntity<Map<String, Object>> put(String session, String uri, Map<String, ?> body) {
		return signedIn(http().put(), session, uri).body(body).retrieve().toEntity(JSON_OBJECT);
	}

	@SuppressWarnings("unchecked")
	private static Object reference(ResponseEntity<Map<String, Object>> ticket) {
		return ((Map<String, Object>) ticket.getBody().get("summary")).get("reference");
	}

	/// A JSON request as the signed-in SPA sends it: the session and a freshly primed CSRF token.
	private RequestBodySpec signedIn(RequestBodyUriSpec method, String session, String uri) {
		var csrf = primeCsrf();
		return method.uri(uri).header("X-XSRF-TOKEN", csrf.header())
				.header(HttpHeaders.COOKIE, csrf.cookie() + "; SESSION=" + session)
				.contentType(MediaType.APPLICATION_JSON);
	}

	private record ScriptResult(int exitCode, String output) {
	}

}
