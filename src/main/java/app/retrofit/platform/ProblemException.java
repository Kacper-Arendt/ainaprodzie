package app.retrofit.platform;

import java.net.URI;
import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.web.ErrorResponseException;

/// Typed application errors carrying their own problem+json body, so `ProblemDetailAdvice` needs no
/// per-feature knowledge: it only normalises the [ProblemDetail] this exception already provides.
///
/// The type URI is always `https://retrofit.app/problems/<slug>`; the slug is the stable contract the SPA
/// switches on. [#problemDetail] is the one place a problem body is assembled, also for the error paths that
/// never throw this exception (the advice's own handlers, the security filter chain).
public class ProblemException extends ErrorResponseException {

	public static final URI TYPE_BASE = URI.create("https://retrofit.app/problems/");

	private ProblemException(HttpStatus status, String typeSlug, String title, String detail, List<?> errors) {
		super(status, problemDetail(status, typeSlug, title, detail, errors), null);
	}

	/// The request needs a session the caller does not have, or no longer has.
	public static ProblemException unauthorized(String typeSlug, String title, String detail) {
		return new ProblemException(HttpStatus.UNAUTHORIZED, typeSlug, title, detail, List.of());
	}

	/// The resource does not exist, or exists but the caller may not learn that it does.
	public static ProblemException notFound(String typeSlug, String title, String detail) {
		return new ProblemException(HttpStatus.NOT_FOUND, typeSlug, title, detail, List.of());
	}

	/// The caller is known and the resource visible, but this operation is not theirs to perform.
	public static ProblemException forbidden(String typeSlug, String title, String detail) {
		return new ProblemException(HttpStatus.FORBIDDEN, typeSlug, title, detail, List.of());
	}

	/// The request is valid but the resource's current state rules it out.
	public static ProblemException conflict(String typeSlug, String title, String detail) {
		return new ProblemException(HttpStatus.CONFLICT, typeSlug, title, detail, List.of());
	}

	/// The caller's `If-Match` names a stale version. `eTag` is the current entity tag, already quoted, so the
	/// caller can retry against it; `ProblemDetailAdvice` copies the exception's headers to the response.
	public static ProblemException preconditionFailed(String typeSlug, String title, String detail, String eTag) {
		var problem = new ProblemException(HttpStatus.PRECONDITION_FAILED, typeSlug, title, detail, List.of());
		problem.getHeaders().setETag(eTag);
		return problem;
	}

	/// A conditional operation arrived without the `If-Match` it requires.
	public static ProblemException preconditionRequired(String typeSlug, String title, String detail) {
		return new ProblemException(HttpStatus.PRECONDITION_REQUIRED, typeSlug, title, detail, List.of());
	}

	/// A 422 that is not about individual fields, so it carries its own slug instead of `validation`.
	public static ProblemException unprocessable(String typeSlug, String title, String detail) {
		return new ProblemException(HttpStatus.UNPROCESSABLE_CONTENT, typeSlug, title, detail, List.of());
	}

	public static ProblemException validation(List<FieldError> errors) {
		return new ProblemException(HttpStatus.UNPROCESSABLE_CONTENT, "validation", "Validation failed",
				"One or more request fields are invalid.", errors);
	}

	/// The 500 answered for every unexpected failure: nothing about the cause reaches the caller.
	public static ProblemDetail internal() {
		return problemDetail(HttpStatus.INTERNAL_SERVER_ERROR, "internal", "Internal server error",
				"An unexpected error occurred.", List.of());
	}

	/// The shared shape `{type, title, status, detail, errors[]}`, with the type resolved under [#TYPE_BASE].
	public static ProblemDetail problemDetail(HttpStatusCode status, String typeSlug, String title, String detail,
			List<?> errors) {
		var problem = ProblemDetail.forStatusAndDetail(status, detail);
		problem.setType(TYPE_BASE.resolve(typeSlug));
		problem.setTitle(title);
		problem.setProperty("errors", errors);
		return problem;
	}

}
