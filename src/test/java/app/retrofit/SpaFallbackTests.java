package app.retrofit;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;

import app.retrofit.auth.Role;

/// Browser routes are forwarded to `index.html` while `/api/**` and asset requests keep their real responses. A real
/// server rather than MockMvc, because MockMvc does not execute forwards. The shell is the test fixture in
/// src/test/resources/static.
class SpaFallbackTests extends RandomPortContext {

	private static final String SPA_SHELL_MARKER = "data-testid=\"spa-shell\"";

	@Autowired
	PasswordEncoder passwordEncoder;

	@Test
	void deepLinksServeTheShell() {
		for (String deepLink : List.of("/login", "/tickets/123")) {
			var response = get(deepLink, null);

			assertThat(response.getStatusCode().value()).as("status of %s", deepLink).isEqualTo(200);
			assertThat(response.getHeaders().getContentType()).as("content type of %s", deepLink)
					.matches(contentType -> contentType.isCompatibleWith(MediaType.TEXT_HTML));
			assertThat(response.getBody()).as("body of %s", deepLink).contains(SPA_SHELL_MARKER);
		}
	}

	@Test
	void unknownApiPathsAndMissingAssetsAre404NotTheShell() {
		// Signed in so /api/unknown reaches routing (404) rather than the 401 entry point.
		var user = new TestUsers(jdbc, passwordEncoder).create(Role.USER);
		var session = login(user.email(), user.password());

		var unknownApi = get("/api/unknown", session);
		assertThat(unknownApi.getStatusCode().value()).isEqualTo(404);
		assertThat(unknownApi.getHeaders().getContentType())
				.matches(contentType -> contentType.isCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
		assertThat(unknownApi.getBody()).doesNotContain(SPA_SHELL_MARKER)
				.contains("\"type\":\"https://retrofit.app/problems/not-found\"");

		var missingAsset = get("/assets/whatever.js", null);
		assertThat(missingAsset.getStatusCode().value()).isEqualTo(404);
		assertThat(missingAsset.getBody()).doesNotContain(SPA_SHELL_MARKER);
	}

	private ResponseEntity<String> get(String uri, String session) {
		var request = http().get().uri(uri);
		if (session != null) {
			request.header(HttpHeaders.COOKIE, "SESSION=" + session);
		}
		return request.retrieve().toEntity(String.class);
	}

}
