package app.retrofit.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;

import app.retrofit.RandomPortContext;
import app.retrofit.TestUsers;

/// `PUT /api/auth/language` over the real server: storage, the session view of it, and validation.
class LanguageTests extends RandomPortContext {

	private static final String PROBLEMS = "https://retrofit.app/problems/";

	private static final ParameterizedTypeReference<Map<String, Object>> JSON_OBJECT = new ParameterizedTypeReference<>() {
	};

	@Autowired
	PasswordEncoder passwordEncoder;

	TestUsers users;

	@BeforeEach
	void setUp() {
		users = new TestUsers(jdbc, passwordEncoder);
	}

	@Test
	void storedLanguageShowsInTheSessionWithoutANewLogin() {
		var user = users.create(Role.USER);
		var session = login(user.email(), user.password());

		var response = putLanguage(session, Map.of("language", "pl"));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
		var body = http().get().uri("/api/auth/session")
				.header(HttpHeaders.COOKIE, "SESSION=" + session)
				.retrieve()
				.body(JSON_OBJECT);
		assertThat(body).containsEntry("language", "pl");
		assertThat(storedLanguage(user.id())).isEqualTo("pl");
	}

	@Test
	void updatingTheLanguageAdvancesUpdatedAt() {
		var user = users.create(Role.USER);
		var session = login(user.email(), user.password());
		var before = updatedAt(user.id());

		putLanguage(session, Map.of("language", "pl"));

		assertThat(updatedAt(user.id())).isAfter(before);
	}

	@Test
	void unknownLanguageIsAValidationProblem() {
		var user = users.create(Role.USER);
		var session = login(user.email(), user.password());

		var response = putLanguage(session, Map.of("language", "de"));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
		assertThat(MediaType.APPLICATION_PROBLEM_JSON.isCompatibleWith(response.getHeaders().getContentType())).isTrue();
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "validation");
		assertThat(firstError(response)).containsEntry("field", "language").containsEntry("code", "language.unknown");
		assertThat(storedLanguage(user.id())).isEqualTo("en");
	}

	@Test
	void blankOrNullLanguageIsRequired() {
		var user = users.create(Role.USER);
		var session = login(user.email(), user.password());
		var nullLanguage = new HashMap<String, Object>();
		nullLanguage.put("language", null);

		for (var body : List.<Map<String, Object>>of(Map.of("language", ""), nullLanguage)) {
			var response = putLanguage(session, body);

			assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
			assertThat(firstError(response)).containsEntry("field", "language").containsEntry("code", "field.required");
		}
	}

	@Test
	void anonymousLanguageChangeIsUnauthorized() {
		var response = putLanguage(null, Map.of("language", "pl"));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
	}

	@SuppressWarnings("unchecked")
	private static Map<String, Object> firstError(ResponseEntity<Map<String, Object>> response) {
		return ((List<Map<String, Object>>) response.getBody().get("errors")).getFirst();
	}

	private ResponseEntity<Map<String, Object>> putLanguage(String session, Map<String, Object> body) {
		var csrf = primeCsrf();
		var cookies = session == null ? csrf.cookie() : csrf.cookie() + "; SESSION=" + session;
		return http().put().uri("/api/auth/language")
				.header("X-XSRF-TOKEN", csrf.header())
				.header(HttpHeaders.COOKIE, cookies)
				.contentType(MediaType.APPLICATION_JSON)
				.body(body)
				.retrieve()
				.toEntity(JSON_OBJECT);
	}

	private String storedLanguage(UUID id) {
		return jdbc.sql("SELECT language FROM app_user WHERE id = :id").param("id", id).query(String.class).single();
	}

	private Instant updatedAt(UUID id) {
		return jdbc.sql("SELECT updated_at FROM app_user WHERE id = :id")
				.param("id", id)
				.query((rs, rowNum) -> rs.getTimestamp("updated_at").toInstant())
				.single();
	}

}
