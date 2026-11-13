package app.retrofit.auth;

import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.context.SecurityContextHolderStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.stereotype.Service;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/// Programmatic session login (no formLogin): authenticate, replace the session against fixation, persist the
/// security context explicitly, and rotate the CSRF token. An `AuthenticationException` propagates to
/// `ProblemDetailAdvice`, which answers the same 401 for every failure.
///
/// With formLogin and logout disabled, Spring Security's own CSRF rotation and logout cleanup never run, so both
/// happen here: a token planted before login is useless after it, and none survives a logout.
@Service
class LoginService {

	private final AuthenticationManager authenticationManager;

	private final SecurityContextRepository securityContextRepository = new HttpSessionSecurityContextRepository();

	private final SecurityContextHolderStrategy securityContextHolderStrategy = SecurityContextHolder
			.getContextHolderStrategy();

	private final CsrfTokenRepository csrfTokenRepository;

	LoginService(AuthenticationManager authenticationManager, CsrfTokenRepository csrfTokenRepository) {
		this.authenticationManager = authenticationManager;
		this.csrfTokenRepository = csrfTokenRepository;
	}

	UserPrincipal login(String email, String password, HttpServletRequest request, HttpServletResponse response) {
		var authentication = authenticationManager
				.authenticate(UsernamePasswordAuthenticationToken.unauthenticated(email, password));
		// Session fixation, and deliberately not `changeSessionId()`. Renaming keeps the same stored row, so a request
		// still in flight on the pre-login cookie puts its own id back on that row when it commits, and the cookie
		// this response is about to set is dead on arrival. A new session gets a primary id no in-flight request has
		// ever seen, so a late writer updates nothing. It also destroys the old session outright rather than handing
		// it a new name.
		var preLogin = request.getSession(false);
		if (preLogin != null) {
			preLogin.invalidate();
		}
		request.getSession(true);
		var context = securityContextHolderStrategy.createEmptyContext();
		context.setAuthentication(authentication);
		securityContextHolderStrategy.setContext(context);
		securityContextRepository.saveContext(context, request, response);
		// A fresh token right away rather than a cleared one: the SPA reads the cookie on every mutation, and its
		// next request may well be one.
		csrfTokenRepository.saveToken(csrfTokenRepository.generateToken(request), request, response);
		return (UserPrincipal) authentication.getPrincipal();
	}

	/// Idempotent: a request without a live session is already logged out. The CSRF cookie is cleared; the next
	/// request (the login screen's session probe) is issued a new one.
	void logout(HttpServletRequest request, HttpServletResponse response) {
		var session = request.getSession(false);
		if (session != null) {
			session.invalidate();
		}
		securityContextHolderStrategy.clearContext();
		csrfTokenRepository.saveToken(null, request, response);
	}

}
