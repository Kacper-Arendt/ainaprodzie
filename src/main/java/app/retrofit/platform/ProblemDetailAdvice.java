package app.retrofit.platform;

import java.net.URI;
import java.util.List;
import java.util.Locale;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.event.Level;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.authentication.InternalAuthenticationServiceException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import jakarta.servlet.http.HttpServletRequest;

/// Global problem+json error contract: every error body is `{type, title, status, detail, errors[]}` with stable type
/// slugs the SPA can switch on (auth/invalid-credentials, auth/unauthenticated, validation, malformed-request,
/// internal, and a status-derived slug such as not-found for framework errors).
///
/// Every refusal answered here is also logged once, here: see [#logRefusal]. Refusals written by the security
/// filter chain (no session, a missing CSRF token) never reach this class and are logged by `SecurityConfig`
/// through the same [RefusalLog].
@RestControllerAdvice
class ProblemDetailAdvice {

	private static final Logger log = LoggerFactory.getLogger(ProblemDetailAdvice.class);

	private static final URI ABOUT_BLANK = URI.create("about:blank");

	@ExceptionHandler(AuthenticationException.class)
	ResponseEntity<ProblemDetail> invalidCredentials(AuthenticationException ex, HttpServletRequest request) {
		// Identical body for every authentication failure: no user enumeration.
		var body = ProblemException.problemDetail(HttpStatus.UNAUTHORIZED, "auth/invalid-credentials",
				"Invalid credentials", "Invalid email or password.", List.of());
		logRefusal(request, body);
		return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(body);
	}

	/// The user lookup itself failed (the database is down, the pool is exhausted): an outage, not a wrong password.
	/// The provider wraps it in an `AuthenticationException`, so without this handler it would read as bad
	/// credentials and leave no trace.
	@ExceptionHandler(InternalAuthenticationServiceException.class)
	ResponseEntity<ProblemDetail> authenticationServiceFailure(InternalAuthenticationServiceException ex) {
		log.error("Authentication could not be checked", ex);
		return internalError();
	}

	/// A body the binder cannot read (malformed JSON, or a primitive field the caller omitted entirely) is the
	/// caller's mistake. Without this handler it falls through to the catch-all and answers 500.
	@ExceptionHandler(HttpMessageNotReadableException.class)
	ResponseEntity<ProblemDetail> unreadableBody(HttpMessageNotReadableException ex, HttpServletRequest request) {
		// The exception message quotes the offending body (a login body holds a password), so it is never echoed
		// and never logged.
		var body = ProblemException.problemDetail(HttpStatus.BAD_REQUEST, "malformed-request", "Malformed request",
				"The request body could not be read.", List.of());
		logRefusal(request, body);
		return ResponseEntity.badRequest().body(body);
	}

	/// The same mistake in the URL rather than the body: a path variable or query parameter the binder cannot convert,
	/// most often an id that is not a UUID. Same 400 shape as [#unreadableBody].
	@ExceptionHandler(MethodArgumentTypeMismatchException.class)
	ResponseEntity<ProblemDetail> unreadableParameter(MethodArgumentTypeMismatchException ex,
			HttpServletRequest request) {
		// The offending value is caller-controlled and never echoed; the name alone says which parameter to look at.
		var body = ProblemException.problemDetail(HttpStatus.BAD_REQUEST, "malformed-request", "Malformed request",
				"The request parameter '" + ex.getName() + "' could not be read.", List.of());
		logRefusal(request, body);
		return ResponseEntity.badRequest().body(body);
	}

	@ExceptionHandler(Exception.class)
	ResponseEntity<ProblemDetail> unexpected(Exception ex, HttpServletRequest request) {
		if (ex instanceof ErrorResponse errorResponse) {
			// Framework errors (404, 405) and every ProblemException already carry a ProblemDetail: normalise it to
			// the shared shape, preserving its headers.
			var body = errorResponse.getBody();
			if (body.getProperties() == null || !body.getProperties().containsKey("errors")) {
				body.setProperty("errors", List.of());
			}
			if (body.getType() == null || ABOUT_BLANK.equals(body.getType())) {
				// Framework errors carry no type (or about:blank); give them a slug the SPA can switch on too.
				body.setType(ProblemException.TYPE_BASE.resolve(statusSlug(errorResponse.getStatusCode())));
			}
			logRefusal(request, body);
			return ResponseEntity.status(errorResponse.getStatusCode())
					.headers(errorResponse.getHeaders())
					.body(body);
		}
		log.error("Unhandled exception", ex);
		return internalError();
	}

	private static ResponseEntity<ProblemDetail> internalError() {
		return ResponseEntity.internalServerError().body(ProblemException.internal());
	}

	/// `not-found`, `method-not-allowed`: the status name in the slug style.
	private static String statusSlug(HttpStatusCode status) {
		var known = HttpStatus.resolve(status.value());
		return known == null ? "http-" + status.value() : known.name().toLowerCase(Locale.ROOT).replace('_', '-');
	}

	/// Every typed refusal leaves evidence, written once here rather than at each throw site. `ProblemException`
	/// extends `ErrorResponseException`, so a business refusal returns from the branch above and would otherwise
	/// reach no log statement at all. A 404 is logged at debug: any caller can mint one with an arbitrary path, so it is
	/// noise at warn.
	private static void logRefusal(HttpServletRequest request, ProblemDetail body) {
		RefusalLog.log(log, body.getStatus() == HttpStatus.NOT_FOUND.value() ? Level.DEBUG : Level.WARN, request, body);
	}

}
