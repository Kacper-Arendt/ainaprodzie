package app.retrofit.platform;

import java.io.IOException;

import org.springframework.core.Ordered;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletResponseWrapper;

/// Cache policy for the served SPA bundle, stated explicitly rather than left to Spring Security's default
/// `no-store` on every response.
///
/// - `/assets/**` is content-hashed by the build, so a file cannot change under its name: cached forever. Only
///   a response that actually serves the file, though: a 404 for an old hash (a tab still running the previous shell)
///   or a 5xx stays uncached, or it would be pinned for a year.
/// - Everything else this filter sees (the shell, deep-link forwards, root-level static files) is never cached, so a
///   new build reaches the browser on the next load.
///
/// `/api/**` and `/actuator/**` are left to Spring Security, whose header writer keeps them uncached.
/// That writer skips any response that already carries `Cache-Control`, so the two never fight.
@Component
class StaticCacheHeadersFilter implements Filter, Ordered {

	private static final String NO_STORE = "no-cache, no-store, max-age=0, must-revalidate";

	private static final String IMMUTABLE = "public, max-age=31536000, immutable";

	@Override
	public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
			throws IOException, ServletException {
		if (request instanceof HttpServletRequest httpRequest && response instanceof HttpServletResponse httpResponse) {
			var path = httpRequest.getRequestURI();
			if (path.startsWith("/assets/")) {
				httpResponse.setHeader(HttpHeaders.CACHE_CONTROL, IMMUTABLE);
				chain.doFilter(request, new AssetResponse(httpResponse));
				return;
			}
			if (!path.startsWith("/api/") && !path.startsWith("/actuator/")) {
				httpResponse.setHeader(HttpHeaders.CACHE_CONTROL, NO_STORE);
			}
		}
		chain.doFilter(request, response);
	}

	/// Falls back to `NO_STORE` as soon as the status says the file was not served.
	private static final class AssetResponse extends HttpServletResponseWrapper {

		AssetResponse(HttpServletResponse response) {
			super(response);
		}

		@Override
		public void setStatus(int status) {
			super.setStatus(status);
			// 304 answers a revalidation of a file that was served, so it keeps the immutable policy.
			if (!HttpStatusCode.valueOf(status).is2xxSuccessful() && status != HttpStatus.NOT_MODIFIED.value()) {
				setHeader(HttpHeaders.CACHE_CONTROL, NO_STORE);
			}
		}

		@Override
		public void sendError(int status) throws IOException {
			setHeader(HttpHeaders.CACHE_CONTROL, NO_STORE);
			super.sendError(status);
		}

		@Override
		public void sendError(int status, String message) throws IOException {
			setHeader(HttpHeaders.CACHE_CONTROL, NO_STORE);
			super.sendError(status, message);
		}

	}

	/// Ahead of the security chain, so the header is already set when Spring Security's writer looks.
	@Override
	public int getOrder() {
		return Ordered.HIGHEST_PRECEDENCE + 10;
	}

}
