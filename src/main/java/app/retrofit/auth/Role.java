package app.retrofit.auth;

import io.swagger.v3.oas.annotations.media.Schema;

/// The role vocabulary. It is the single source the `app_user_roles_check` constraint, the Spring authorities
/// (`ROLE_USER`, `ROLE_SUPPORT`) and the generated TypeScript client all spell the same way. Public because
/// server test suites create users with it.
@Schema(description = "User role. USER is a customer, SUPPORT is support staff.")
public enum Role {

	USER, SUPPORT

}
