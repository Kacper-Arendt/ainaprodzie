package app.retrofit.auth;

import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

/// Resolves login emails (case-insensitively) to principals. A missing or disabled user is the same
/// [UsernameNotFoundException], which the provider turns into the same bad-credentials failure as a wrong
/// password: no user enumeration.
@Service
class AppUserDetailsService implements UserDetailsService {

	private final JdbcUserRepository users;

	AppUserDetailsService(JdbcUserRepository users) {
		this.users = users;
	}

	@Override
	public UserDetails loadUserByUsername(String email) {
		return users.findByEmail(email)
				.filter(JdbcUserRepository.UserRecord::enabled)
				.map(user -> new UserPrincipal(user.id(), user.roles(), user.passwordHash()))
				.orElseThrow(() -> new UsernameNotFoundException("No enabled user for the given email"));
	}

}
