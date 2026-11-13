package app.retrofit.auth;

import java.io.Serializable;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.security.core.CredentialsContainer;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

/// The authenticated principal stored in the session. `getUsername()` returns the user id, so
/// `Authentication.getName()` is the id and never the email.
///
/// Holds the password hash only until [#eraseCredentials()] clears it, which the `ProviderManager`
/// does right after a successful credential check: the hash must never be serialized into
/// `spring_session_attributes`. Everything else the session endpoint shows is read fresh from the row.
final class UserPrincipal implements UserDetails, CredentialsContainer, Serializable {

	private static final long serialVersionUID = 1L;

	private final UUID id;

	private final List<Role> roles;

	private String passwordHash;

	UserPrincipal(UUID id, List<Role> roles, String passwordHash) {
		this.id = id;
		this.roles = List.copyOf(roles);
		this.passwordHash = passwordHash;
	}

	UUID id() {
		return id;
	}

	@Override
	public void eraseCredentials() {
		this.passwordHash = null;
	}

	@Override
	public Collection<? extends GrantedAuthority> getAuthorities() {
		return roles.stream().map(role -> new SimpleGrantedAuthority("ROLE_" + role.name())).toList();
	}

	@Override
	public String getPassword() {
		return passwordHash;
	}

	@Override
	public String getUsername() {
		return id.toString();
	}

}
