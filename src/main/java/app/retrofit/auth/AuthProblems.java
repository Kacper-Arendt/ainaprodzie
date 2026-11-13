package app.retrofit.auth;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;

import app.retrofit.platform.ProblemException;

/// The auth refusal bodies, kept next to each other. [#unauthenticated] is answered from several places, so one
/// definition keeps their bodies identical; one of them is `organization.CallerLookup`, which is why the type is
/// public. [#forbidden] has a single caller, the security chain's access-denied handler.
public final class AuthProblems {

	private AuthProblems() {
	}

	/// No session, or the session's user has since been disabled or removed.
	public static ProblemException unauthenticated() {
		return ProblemException.unauthorized("auth/unauthenticated", "Unauthenticated",
				"Authentication is required to access this resource.");
	}

	static ProblemDetail forbidden() {
		return ProblemException.problemDetail(HttpStatus.FORBIDDEN, "auth/forbidden", "Forbidden",
				"You do not have permission to perform this action.", List.of());
	}

}
