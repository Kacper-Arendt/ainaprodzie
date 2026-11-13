package app.retrofit.auth;

import java.io.IOException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import tools.jackson.databind.json.JsonMapper;

import app.retrofit.platform.ProblemException;

/// Re-checks the signed-in user's row on every `/api` request, so disabling or deleting a user ends their live
/// sessions at once rather than at the idle timeout. A missing or disabled user loses the session and gets the same 401
/// `auth/unauthenticated` as a caller without one: the exception reaches the entry point through
/// `ExceptionTranslationFilter`, which is why this filter sits before `AuthorizationFilter`.
///
/// Paths are matched like the authorization rules and Spring MVC match them, on the decoded path, so an encoded
/// `/%61pi/...` cannot slip past. Login and logout are skipped: login replaces the session anyway, and logout must
/// stay an idempotent 204. The public `GET /api/meta` is skipped too.
final class EnabledUserFilter extends OncePerRequestFilter {

	private static final Logger log = LoggerFactory.getLogger(EnabledUserFilter.class);

	private final RequestMatcher api;

	private final RequestMatcher skipped;

	private final JdbcUserRepository users;

	private final JsonMapper json;

	/// @param paths Spring Security's own builder, the one `authorizeHttpRequests` uses, so any MVC path-match
	/// customization or servlet path applies to this filter exactly as it does to the authorization rules
	EnabledUserFilter(JdbcUserRepository users, JsonMapper json, PathPatternRequestMatcher.Builder paths) {
		this.users = users;
		this.json = json;
		this.api = paths.matcher("/api/**");
		this.skipped = new OrRequestMatcher(paths.matcher(HttpMethod.POST, "/api/auth/login"),
				paths.matcher(HttpMethod.POST, "/api/auth/logout"), paths.matcher(HttpMethod.GET, "/api/meta"));
	}

	@Override
	protected boolean shouldNotFilter(HttpServletRequest request) {
		return !this.api.matches(request) || this.skipped.matches(request);
	}

	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
			throws ServletException, IOException {
		var authentication = SecurityContextHolder.getContextHolderStrategy().getContext().getAuthentication();
		if (authentication != null && authentication.getPrincipal() instanceof UserPrincipal principal) {
			boolean enabled;
			try {
				enabled = users.findById(principal.id()).map(JdbcUserRepository.UserRecord::enabled).orElse(false);
			}
			catch (DataAccessException ex) {
				// Thrown from a filter, this would bypass ProblemDetailAdvice and reach the container's error page.
				log.error("Signed-in user could not be checked", ex);
				SecurityConfig.writeProblem(response, ProblemException.internal(), json);
				return;
			}
			if (!enabled) {
				log.info("Signed-in user {} is disabled or removed: session invalidated", principal.id());
				var session = request.getSession(false);
				if (session != null) {
					session.invalidate();
				}
				throw new DisabledException("The signed-in user is disabled or no longer exists");
			}
		}
		filterChain.doFilter(request, response);
	}

}
