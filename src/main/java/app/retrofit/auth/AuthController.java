package app.retrofit.auth;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

@RestController
@RequestMapping("/api/auth")
@Tag(name = "auth", description = "Session-cookie authentication. Errors are RFC 9457 problem+json "
		+ "with stable type slugs under https://retrofit.app/problems/.")
class AuthController {

	private static final String PROBLEM_JSON = "application/problem+json";

	// Deliberately without bean validation: a blank or missing field must reach the authentication manager and get
	// the same 401 as a wrong password, not a 400 that tells the caller which part was wrong.
	record LoginRequest(String email, String password) {
	}

	// An open String rather than Language: the service owns the allowlist and answers 422, not a 400 parse error.
	record LanguageRequest(@Schema(requiredMode = REQUIRED, description = "en or pl") String language) {
	}

	record SessionUser(@Schema(requiredMode = REQUIRED) UUID id,
			@Schema(requiredMode = REQUIRED) String email,
			@Schema(requiredMode = REQUIRED) String displayName,
			@Schema(requiredMode = REQUIRED) List<Role> roles,
			@Schema(requiredMode = REQUIRED) Language language) {

		static SessionUser of(JdbcUserRepository.UserRecord user) {
			return new SessionUser(user.id(), user.email(), user.displayName(), user.roles(), user.language());
		}
	}

	private final LoginService loginService;

	private final JdbcUserRepository users;

	private final LanguagePreferenceService languagePreference;

	AuthController(LoginService loginService, JdbcUserRepository users, LanguagePreferenceService languagePreference) {
		this.loginService = loginService;
		this.users = users;
		this.languagePreference = languagePreference;
	}

	@Operation(summary = "Log in with email and password; establishes the session cookie")
	@ApiResponse(responseCode = "200", description = "Logged in; SESSION cookie set")
	@ApiResponse(responseCode = "400", description = "Problem type slug: malformed-request (body is not JSON)",
			content = @Content(mediaType = PROBLEM_JSON, schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "401", description = "Problem type slug: auth/invalid-credentials "
			+ "(identical body for every authentication failure, blank or missing fields included)",
			content = @Content(mediaType = PROBLEM_JSON, schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "403", description = "Problem type slug: auth/forbidden (missing CSRF token)",
			content = @Content(mediaType = PROBLEM_JSON, schema = @Schema(implementation = ProblemDetail.class)))
	@PostMapping("/login")
	SessionUser login(@RequestBody LoginRequest body, HttpServletRequest request, HttpServletResponse response) {
		var principal = loginService.login(Objects.requireNonNullElse(body.email(), ""),
				Objects.requireNonNullElse(body.password(), ""), request, response);
		return currentUser(principal.id());
	}

	@Operation(summary = "Log out; invalidates the current session (idempotent)")
	@ApiResponse(responseCode = "204", description = "Session invalidated (also when no session existed)")
	@ApiResponse(responseCode = "403", description = "Problem type slug: auth/forbidden (missing CSRF token)",
			content = @Content(mediaType = PROBLEM_JSON, schema = @Schema(implementation = ProblemDetail.class)))
	@PostMapping("/logout")
	ResponseEntity<Void> logout(HttpServletRequest request, HttpServletResponse response) {
		loginService.logout(request, response);
		return ResponseEntity.noContent().build();
	}

	@Operation(summary = "The signed-in user, read fresh from the database on every call")
	@ApiResponse(responseCode = "200", description = "Authenticated session")
	@ApiResponse(responseCode = "401", description = "Problem type slug: auth/unauthenticated "
			+ "(no session, or the user has since been disabled or removed)",
			content = @Content(mediaType = PROBLEM_JSON, schema = @Schema(implementation = ProblemDetail.class)))
	@GetMapping("/session")
	SessionUser session(@AuthenticationPrincipal UserPrincipal principal) {
		return currentUser(principal.id());
	}

	@Operation(summary = "Store the signed-in user's UI language")
	@ApiResponse(responseCode = "204", description = "Language stored")
	@ApiResponse(responseCode = "401", description = "Problem type slug: auth/unauthenticated",
			content = @Content(mediaType = PROBLEM_JSON, schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "403", description = "Problem type slug: auth/forbidden (missing CSRF token)",
			content = @Content(mediaType = PROBLEM_JSON, schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "422", description = "Problem type slug: validation "
			+ "(errors[].code field.required or language.unknown)",
			content = @Content(mediaType = PROBLEM_JSON, schema = @Schema(implementation = ProblemDetail.class)))
	@PutMapping("/language")
	ResponseEntity<Void> language(@AuthenticationPrincipal UserPrincipal principal, @RequestBody LanguageRequest body) {
		languagePreference.change(principal.id(), body.language());
		return ResponseEntity.noContent().build();
	}

	private SessionUser currentUser(UUID id) {
		return users.findById(id)
				.filter(JdbcUserRepository.UserRecord::enabled)
				.map(SessionUser::of)
				.orElseThrow(AuthProblems::unauthenticated);
	}

}
