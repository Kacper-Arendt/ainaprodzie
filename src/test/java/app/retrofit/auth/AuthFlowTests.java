package app.retrofit.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;

import app.retrofit.RandomPortContext;
import app.retrofit.TestUsers;

/// The session login flow over the real server, sending cookies and the CSRF header by hand as the SPA does.
@ExtendWith(OutputCaptureExtension.class)
class AuthFlowTests extends RandomPortContext {

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
	void loginWithMixedCaseEmailReturnsSessionUserAndHardenedCookie() {
		var user = users.create(Role.SUPPORT);
		var csrf = primeCsrf();

		var login = http().post().uri("/api/auth/login")
				.header("X-XSRF-TOKEN", csrf.header())
				.header(HttpHeaders.COOKIE, csrf.cookie())
				.contentType(MediaType.APPLICATION_JSON)
				.body(Map.of("email", user.email().toUpperCase(), "password", user.password()))
				.retrieve()
				.toEntity(String.class);

		assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);
		var sessionCookie = setCookie(login, "SESSION");
		assertThat(sessionCookie).contains("HttpOnly", "Secure", "SameSite=Lax").doesNotContainIgnoringCase("Max-Age");

		var session = http().get().uri("/api/auth/session")
				.header(HttpHeaders.COOKIE, "SESSION=" + cookieValue(login, "SESSION"))
				.retrieve()
				.toEntity(String.class);

		assertThat(session.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(session.getBody()).isEqualTo(login.getBody());
		var body = http().get().uri("/api/auth/session")
				.header(HttpHeaders.COOKIE, "SESSION=" + cookieValue(login, "SESSION"))
				.retrieve()
				.body(JSON_OBJECT);
		assertThat(body).containsOnlyKeys("id", "email", "displayName", "roles", "language")
				.containsEntry("id", user.id().toString())
				.containsEntry("email", user.email())
				.containsEntry("roles", List.of("SUPPORT"))
				.containsEntry("language", "en");
		for (var response : List.of(login.getBody(), session.getBody())) {
			assertThat(response).doesNotContain("password", "$2a$", "{bcrypt}");
		}
	}

	@Test
	void everyCredentialFailureIsTheSameUnauthorizedProblem() {
		var user = users.create(Role.USER);
		var disabled = users.create(Role.USER);
		users.disable(disabled.id());

		var bodies = List.of(
				"{\"email\":\"" + user.email() + "\",\"password\":\"wrong-password\"}",
				"{\"email\":\"nobody@retrofit.test\",\"password\":\"" + user.password() + "\"}",
				"{\"email\":\"" + disabled.email() + "\",\"password\":\"" + disabled.password() + "\"}",
				"{\"email\":\"\",\"password\":\"\"}",
				"{\"email\":\"  \",\"password\":\" \"}",
				"{}");

		var responses = bodies.stream().map(this::postLogin).toList();

		for (var response : responses) {
			assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
			assertThat(MediaType.APPLICATION_PROBLEM_JSON.isCompatibleWith(response.getHeaders().getContentType())).isTrue();
			assertThat(response.getBody()).contains("\"type\":\"" + PROBLEMS + "auth/invalid-credentials\"")
					.contains("\"detail\":\"Invalid email or password.\"");
			assertThat(response.getBody()).isEqualTo(responses.getFirst().getBody());
		}
	}

	@Test
	void aFailedLoginIsLoggedWithoutTheCredentials(CapturedOutput output) {
		var user = users.create(Role.USER);

		postLogin("{\"email\":\"" + user.email() + "\",\"password\":\"wrong-password\"}");

		assertThat(output.getOut()).contains("POST /api/auth/login -> 401 " + PROBLEMS + "auth/invalid-credentials")
				.doesNotContain(user.email())
				.doesNotContain("wrong-password");
	}

	@Test
	void aDatabaseFailureDuringLoginIsAnInternalErrorNotBadCredentials(CapturedOutput output) {
		var user = users.create(Role.USER);
		var csrf = primeCsrf();

		ResponseEntity<String> response;
		jdbc.sql("ALTER TABLE app_user RENAME TO app_user_unavailable").update();
		try {
			response = http().post().uri("/api/auth/login")
					.header("X-XSRF-TOKEN", csrf.header())
					.header(HttpHeaders.COOKIE, csrf.cookie())
					.contentType(MediaType.APPLICATION_JSON)
					.body(Map.of("email", user.email(), "password", user.password()))
					.retrieve()
					.toEntity(String.class);
		}
		finally {
			jdbc.sql("ALTER TABLE app_user_unavailable RENAME TO app_user").update();
		}

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
		assertThat(response.getBody()).contains("\"type\":\"" + PROBLEMS + "internal\"");
		assertThat(output.getOut()).contains("ERROR").contains("Authentication could not be checked");
	}

	@Test
	void malformedLoginBodyIsBadRequestNotUnauthorized() {
		var response = postLogin("{not json");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody()).contains("\"type\":\"" + PROBLEMS + "malformed-request\"");
	}

	@Test
	void loginWithoutCsrfHeaderIsForbiddenAndWithItIsNot() {
		var csrf = primeCsrf();
		var body = "{\"email\":\"nobody@retrofit.test\",\"password\":\"x\"}";

		var withoutHeader = http().post().uri("/api/auth/login")
				.header(HttpHeaders.COOKIE, csrf.cookie())
				.contentType(MediaType.APPLICATION_JSON)
				.body(body)
				.retrieve()
				.toEntity(String.class);
		var withHeader = http().post().uri("/api/auth/login")
				.header("X-XSRF-TOKEN", csrf.header())
				.header(HttpHeaders.COOKIE, csrf.cookie())
				.contentType(MediaType.APPLICATION_JSON)
				.body(body)
				.retrieve()
				.toEntity(String.class);

		assertThat(withoutHeader.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
		assertThat(MediaType.APPLICATION_PROBLEM_JSON.isCompatibleWith(withoutHeader.getHeaders().getContentType())).isTrue();
		assertThat(withoutHeader.getBody()).contains("\"type\":\"" + PROBLEMS + "auth/forbidden\"");
		assertThat(withHeader.getStatusCode()).isNotEqualTo(HttpStatus.FORBIDDEN);
	}

	@Test
	void forbiddenCsrfRefusalIsLogged(CapturedOutput output) {
		http().post().uri("/api/auth/logout").retrieve().toBodilessEntity();

		assertThat(output.getOut()).contains("POST /api/auth/logout -> 403 " + PROBLEMS + "auth/forbidden");
	}

	@Test
	void anonymousSessionIsUnauthenticatedAndPrimesReadableCsrfCookie(CapturedOutput output) {
		var response = http().get().uri("/api/auth/session").retrieve().toEntity(String.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(MediaType.APPLICATION_PROBLEM_JSON.isCompatibleWith(response.getHeaders().getContentType())).isTrue();
		assertThat(response.getHeaders().getContentType().getCharset()).isEqualTo(StandardCharsets.UTF_8);
		assertThat(output.getOut())
				.contains("GET /api/auth/session -> 401 " + PROBLEMS + "auth/unauthenticated principal=none");
		assertThat(response.getBody()).contains("\"type\":\"" + PROBLEMS + "auth/unauthenticated\"")
				.contains("\"status\":401").contains("\"errors\":[]");
		assertThat(cookieValue(response, "XSRF-TOKEN")).isNotBlank();
		assertThat(setCookie(response, "XSRF-TOKEN")).doesNotContainIgnoringCase("HttpOnly").contains("SameSite=Lax");
	}

	@Test
	void loginRotatesTheCsrfTokenAndLogoutClearsIt() {
		var user = users.create(Role.USER);
		var csrf = primeCsrf();

		var login = http().post().uri("/api/auth/login")
				.header("X-XSRF-TOKEN", csrf.header())
				.header(HttpHeaders.COOKIE, csrf.cookie())
				.contentType(MediaType.APPLICATION_JSON)
				.body(Map.of("email", user.email(), "password", user.password()))
				.retrieve()
				.toBodilessEntity();

		assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);
		var rotated = cookieValue(login, "XSRF-TOKEN");
		assertThat(rotated).isNotBlank().isNotEqualTo(csrf.header());

		var logout = http().post().uri("/api/auth/logout")
				.header("X-XSRF-TOKEN", rotated)
				.header(HttpHeaders.COOKIE, "XSRF-TOKEN=" + rotated + "; SESSION=" + cookieValue(login, "SESSION"))
				.retrieve()
				.toBodilessEntity();

		assertThat(logout.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
		assertThat(cookieValue(logout, "XSRF-TOKEN")).isEmpty();
		assertThat(setCookie(logout, "XSRF-TOKEN")).contains("Expires=Thu, 01 Jan 1970");
	}

	@Test
	void loginReplacesAnExistingSession() {
		var user = users.create(Role.USER);
		var first = login(user.email(), user.password());
		var csrf = primeCsrf();

		var second = http().post().uri("/api/auth/login")
				.header("X-XSRF-TOKEN", csrf.header())
				.header(HttpHeaders.COOKIE, csrf.cookie() + "; SESSION=" + first)
				.contentType(MediaType.APPLICATION_JSON)
				.body(Map.of("email", user.email(), "password", user.password()))
				.retrieve()
				.toEntity(String.class);
		var secondSession = cookieValue(second, "SESSION");

		assertThat(second.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(secondSession).isNotBlank().isNotEqualTo(first);
		assertThat(sessionStatus(first)).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(sessionStatus(secondSession)).isEqualTo(HttpStatus.OK);
	}

	@Test
	void logoutEndsTheSessionAndIsIdempotent() {
		var user = users.create(Role.USER);
		var session = login(user.email(), user.password());

		assertThat(logout(session)).isEqualTo(HttpStatus.NO_CONTENT);
		assertThat(sessionStatus(session)).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(logout(session)).isEqualTo(HttpStatus.NO_CONTENT);
		assertThat(logout(null)).isEqualTo(HttpStatus.NO_CONTENT);
	}

	@Test
	void disablingTheUserEndsAccessOnTheNextSessionCall() {
		var user = users.create(Role.USER);
		var session = login(user.email(), user.password());
		assertThat(sessionStatus(session)).isEqualTo(HttpStatus.OK);

		users.disable(user.id());

		var response = http().get().uri("/api/auth/session")
				.header(HttpHeaders.COOKIE, "SESSION=" + session)
				.retrieve()
				.toEntity(String.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(response.getBody()).contains("\"type\":\"" + PROBLEMS + "auth/unauthenticated\"");
	}

	/// `/%61pi` is `/api` with one letter percent-encoded: Spring MVC and Spring Security match on the
	/// decoded path, so the enabled check must too.
	@Test
	void aDisabledUsersLiveSessionIsRefusedOnEveryApiCall() {
		var user = users.create(Role.USER);
		var sessions = Map.of("/api/auth/language", login(user.email(), user.password()),
				"/%61pi/auth/language", login(user.email(), user.password()));

		users.disable(user.id());

		var csrf = primeCsrf();
		sessions.forEach((path, session) -> {
			var response = http().put().uri(URI.create("http://localhost:" + port + path))
					.header("X-XSRF-TOKEN", csrf.header())
					.header(HttpHeaders.COOKIE, csrf.cookie() + "; SESSION=" + session)
					.contentType(MediaType.APPLICATION_JSON)
					.body(Map.of("language", "pl"))
					.retrieve()
					.toEntity(String.class);

			assertThat(response.getStatusCode()).as("PUT %s", path).isEqualTo(HttpStatus.UNAUTHORIZED);
			assertThat(response.getBody()).contains("\"type\":\"" + PROBLEMS + "auth/unauthenticated\"");
		});
		assertThat(jdbc.sql("SELECT language FROM app_user WHERE id = :id").param("id", user.id()).query(String.class)
				.single()).isEqualTo("en");

		users.enable(user.id());

		sessions.forEach((path, session) -> assertThat(sessionStatus(session)).as("session refused on %s", path)
				.isEqualTo(HttpStatus.UNAUTHORIZED));
	}

	@Test
	void aDisabledUsersSessionStillReadsThePublicMeta() {
		var user = users.create(Role.USER);
		var session = login(user.email(), user.password());

		users.disable(user.id());

		var response = http().get().uri("/api/meta")
				.header(HttpHeaders.COOKIE, "SESSION=" + session)
				.retrieve()
				.toEntity(String.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
	}

	@Test
	void aUserLookupFailureOnASignedInCallIsAnInternalError(CapturedOutput output) {
		var user = users.create(Role.USER);
		var session = login(user.email(), user.password());

		ResponseEntity<String> response;
		jdbc.sql("ALTER TABLE app_user RENAME TO app_user_unavailable").update();
		try {
			response = http().get().uri("/api/auth/session")
					.header(HttpHeaders.COOKIE, "SESSION=" + session)
					.retrieve()
					.toEntity(String.class);
		}
		finally {
			jdbc.sql("ALTER TABLE app_user_unavailable RENAME TO app_user").update();
		}

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
		assertThat(MediaType.APPLICATION_PROBLEM_JSON.isCompatibleWith(response.getHeaders().getContentType())).isTrue();
		assertThat(response.getBody()).contains("\"type\":\"" + PROBLEMS + "internal\"").contains("\"errors\":[]");
		assertThat(output.getOut()).contains("ERROR").contains("Signed-in user could not be checked");
	}

	private ResponseEntity<String> postLogin(String json) {
		var csrf = primeCsrf();
		return http().post().uri("/api/auth/login")
				.header("X-XSRF-TOKEN", csrf.header())
				.header(HttpHeaders.COOKIE, csrf.cookie())
				.contentType(MediaType.APPLICATION_JSON)
				.body(json)
				.retrieve()
				.toEntity(String.class);
	}

	private HttpStatus sessionStatus(String session) {
		var response = http().get().uri("/api/auth/session")
				.header(HttpHeaders.COOKIE, "SESSION=" + session)
				.retrieve()
				.toBodilessEntity();
		return HttpStatus.valueOf(response.getStatusCode().value());
	}

	private HttpStatus logout(String session) {
		var csrf = primeCsrf();
		var cookies = session == null ? csrf.cookie() : csrf.cookie() + "; SESSION=" + session;
		var response = http().post().uri("/api/auth/logout")
				.header("X-XSRF-TOKEN", csrf.header())
				.header(HttpHeaders.COOKIE, cookies)
				.retrieve()
				.toBodilessEntity();
		return HttpStatus.valueOf(response.getStatusCode().value());
	}

	private static String setCookie(ResponseEntity<?> response, String name) {
		return response.getHeaders().getOrEmpty(HttpHeaders.SET_COOKIE).stream()
				.filter(cookie -> cookie.startsWith(name + "="))
				.findFirst()
				.orElseThrow(() -> new AssertionError("No Set-Cookie for " + name));
	}

}
