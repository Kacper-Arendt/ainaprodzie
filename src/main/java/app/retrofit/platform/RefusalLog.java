package app.retrofit.platform;

import org.slf4j.Logger;
import org.slf4j.event.Level;
import org.springframework.http.ProblemDetail;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import jakarta.servlet.http.HttpServletRequest;

/// The one log line for a refused request, shared by `ProblemDetailAdvice` and the security filter chain so the
/// two cannot drift apart. The slug, the path and the principal name only: never the request body, the problem detail
/// text or the query string. An anonymous caller is logged as `none`. Each caller picks the level.
public final class RefusalLog {

	private RefusalLog() {
	}

	public static void log(Logger logger, Level level, HttpServletRequest request, ProblemDetail body) {
		logger.atLevel(level).log("Request refused: {} {} -> {} {} principal={}", request.getMethod(),
				request.getRequestURI(), body.getStatus(), body.getType(), principalName());
	}

	private static String principalName() {
		var authentication = SecurityContextHolder.getContextHolderStrategy().getContext().getAuthentication();
		return authentication == null || authentication instanceof AnonymousAuthenticationToken ? "none"
				: authentication.getName();
	}

}
