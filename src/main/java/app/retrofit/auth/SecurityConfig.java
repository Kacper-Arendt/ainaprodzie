package app.retrofit.auth;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.event.Level;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.ProblemDetail;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.savedrequest.NullRequestCache;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.session.web.http.DefaultCookieSerializer;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import tools.jackson.databind.json.JsonMapper;

import app.retrofit.platform.RefusalLog;

/// Session-cookie security for the same-origin SPA: programmatic login (no formLogin or httpBasic), Spring Security's
/// SPA CSRF setup, a hardened session cookie, a per-request check that the signed-in user is still enabled, and
/// problem+json auth errors built and logged the same way as in `ProblemDetailAdvice`.
@Configuration
@EnableWebSecurity
class SecurityConfig {

	private static final Logger log = LoggerFactory.getLogger(SecurityConfig.class);

	private static final String PROBLEM_JSON = "application/problem+json";

	@Bean
	SecurityFilterChain securityFilterChain(HttpSecurity http, CookieCsrfTokenRepository csrfTokenRepository,
			JdbcUserRepository users, JsonMapper json, PathPatternRequestMatcher.Builder paths) throws Exception {
		http
				.authorizeHttpRequests(auth -> auth
						.requestMatchers(HttpMethod.POST, "/api/auth/login", "/api/auth/logout").permitAll()
						// The login screen shows the service name before any session exists.
						.requestMatchers(HttpMethod.GET, "/api/meta").permitAll()
						.requestMatchers("/api/teams", "/api/teams/**").hasRole("SUPPORT")
						.requestMatchers("/api/chat/settings", "/api/chat/models").hasRole("SUPPORT")
						.requestMatchers("/api/**").authenticated()
						.requestMatchers("/actuator/health", "/actuator/health/**").permitAll()
						.requestMatchers("/actuator/**").authenticated()
						// The final GET catch-all must stay broad: SPA deep links are arbitrary extension-less paths
						// forwarded to /index.html, so a strict allowlist would break client-side routing. Everything
						// sensitive (/api/**, /actuator/**) is matched by the earlier rules. /v3/api-docs is served
						// only in dev and test (springdoc.api-docs.enabled), never in production.
						.requestMatchers(HttpMethod.GET, "/", "/assets/**", "/**").permitAll()
						.anyRequest().denyAll())
				// No saved request, and therefore no session for an unauthenticated caller. Nothing here consumes one:
				// login is programmatic and the SPA carries its own return path across the login screen, so the stock
				// HttpSessionRequestCache would only ever create a session on the way to a 401. That session would
				// then ride every following asset request, and spring-session rewrites SESSION_ID from whatever the
				// saving request loaded: one of those requests, committing after the login had rotated the id, would
				// put the pre-login id back on the row and kill the cookie the login had just issued.
				.requestCache(cache -> cache.requestCache(new NullRequestCache()))
				// spa(): XOR-masked tokens for form parameters, the raw cookie value accepted from X-XSRF-TOKEN, and the
				// token loaded on every request so each response renders the cookie. The repository is replaced only to
				// set SameSite and to share it with LoginService, which rotates the token.
				.csrf(csrf -> csrf.spa().csrfTokenRepository(csrfTokenRepository))
				.addFilterBefore(new EnabledUserFilter(users, json, paths), AuthorizationFilter.class)
				.exceptionHandling(exceptions -> exceptions
						.authenticationEntryPoint((request, response, ex) -> refuse(request, response,
								AuthProblems.unauthenticated().getBody(), json))
						.accessDeniedHandler((request, response, ex) -> refuse(request, response,
								AuthProblems.forbidden(), json)))
				.formLogin(AbstractHttpConfigurer::disable)
				.httpBasic(AbstractHttpConfigurer::disable)
				.logout(AbstractHttpConfigurer::disable);
		return http.build();
	}

	/// Readable by the SPA by design; SameSite=Lax like the session cookie.
	@Bean
	CookieCsrfTokenRepository csrfTokenRepository() {
		var repository = CookieCsrfTokenRepository.withHttpOnlyFalse();
		repository.setCookieCustomizer(cookie -> cookie.sameSite("Lax"));
		return repository;
	}

	@Bean
	PasswordEncoder passwordEncoder() {
		return PasswordEncoderFactories.createDelegatingPasswordEncoder();
	}

	@Bean
	AuthenticationManager authenticationManager(AppUserDetailsService userDetailsService,
			PasswordEncoder passwordEncoder) {
		var provider = new DaoAuthenticationProvider(userDetailsService);
		provider.setPasswordEncoder(passwordEncoder);
		return new ProviderManager(provider);
	}

	@Bean
	DefaultCookieSerializer cookieSerializer() {
		var serializer = new DefaultCookieSerializer();
		serializer.setUseHttpOnlyCookie(true);
		serializer.setUseSecureCookie(true);
		serializer.setSameSite("Lax");
		// No Max-Age: a browser-session cookie. The server-side inactivity timeout (spring.session.timeout) decides
		// how long the session lives.
		return serializer;
	}

	/// Refusals of the filter chain never reach `ProblemDetailAdvice`, so they are logged here through the same
	/// [RefusalLog]. A caller with no session is routine (every anonymous page load probes the session), so a 401
	/// is logged at info and a 403, a CSRF failure included, at warn.
	private static void refuse(HttpServletRequest request, HttpServletResponse response, ProblemDetail body,
			JsonMapper json) throws IOException {
		RefusalLog.log(log, body.getStatus() == HttpServletResponse.SC_UNAUTHORIZED ? Level.INFO : Level.WARN, request,
				body);
		writeProblem(response, body, json);
	}

	/// A problem+json body written straight to the response, for the filters that answer before Spring MVC does.
	static void writeProblem(HttpServletResponse response, ProblemDetail body, JsonMapper json) throws IOException {
		response.setStatus(body.getStatus());
		response.setContentType(PROBLEM_JSON);
		response.setCharacterEncoding(StandardCharsets.UTF_8);
		response.getWriter().write(json.writeValueAsString(body));
	}

}
