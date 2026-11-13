package app.retrofit.auth;

import java.time.Clock;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import app.retrofit.platform.FieldError;
import app.retrofit.platform.Validations;

@Service
class LanguagePreferenceService {

	// The Language vocabulary, which the app_user_language_check constraint also spells.
	private static final List<String> LANGUAGES = Arrays.stream(Language.values()).map(Language::name).toList();

	private final JdbcUserRepository users;

	private final Clock clock;

	LanguagePreferenceService(JdbcUserRepository users, Clock clock) {
		this.users = users;
		this.clock = clock;
	}

	@Transactional
	void change(UUID userId, String language) {
		List<FieldError> errors = new ArrayList<>();
		var value = Validations.requireAllowed(errors, "language", language, LANGUAGES);
		Validations.throwIfInvalid(errors);
		if (users.updateLanguage(userId, value, clock.instant()) == 0) {
			throw AuthProblems.unauthenticated();
		}
	}

}
