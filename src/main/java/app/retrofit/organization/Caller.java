package app.retrofit.organization;

import java.util.UUID;

/// The signed-in user and the organizations they may see, read fresh from `app_user` for each operation. Public
/// because `ticket` resolves its callers through [CallerLookup].
public sealed interface Caller {

	/// The signed-in user.
	UUID id();

	/// Sees their own organization only.
	record Customer(UUID id, UUID organizationId) implements Caller {
	}

	/// Sees every organization.
	record Support(UUID id) implements Caller {
	}

}
