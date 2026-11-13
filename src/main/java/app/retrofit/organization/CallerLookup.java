package app.retrofit.organization;

import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;

import app.retrofit.auth.AuthProblems;
import app.retrofit.auth.Role;

/// Resolves the signed-in user, once per operation, for organizations and tickets alike. Public because `ticket`
/// resolves its callers here.
@Component
public class CallerLookup {

	private final JdbcClient jdbc;

	CallerLookup(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/// The session principal's name is the user id (`UserPrincipal`), never the email.
	public static UUID callerId(Authentication authentication) {
		return UUID.fromString(authentication.getName());
	}

	Caller current(Authentication authentication) {
		return current(callerId(authentication));
	}

	/// The schema gives every user exactly one role, and a customer always has an organization. A user disabled or
	/// removed since `EnabledUserFilter` admitted the request, or an id with no user at all, is refused with the same
	/// 401 body the filter's refusal answers. Unlike the filter, it leaves the session alone, which the filter then
	/// ends on the caller's next request.
	public Caller current(UUID userId) {
		return jdbc.sql("SELECT roles[1] AS role, organization_id FROM app_user WHERE id = :id AND enabled")
				.param("id", userId)
				.query((rs, rowNum) -> switch (Role.valueOf(rs.getString("role"))) {
					case USER -> new Caller.Customer(userId, rs.getObject("organization_id", UUID.class));
					case SUPPORT -> new Caller.Support(userId);
				})
				.optional()
				.orElseThrow(AuthProblems::unauthenticated);
	}

}
