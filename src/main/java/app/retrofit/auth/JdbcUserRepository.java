package app.retrofit.auth;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
class JdbcUserRepository {

	private static final String SELECT_USER = """
			SELECT id, email, display_name, password_hash, roles, enabled, language
			FROM app_user
			""";

	private final JdbcClient jdbc;

	JdbcUserRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	Optional<UserRecord> findByEmail(String email) {
		return jdbc.sql(SELECT_USER + "WHERE lower(email) = lower(:email)")
				.param("email", email)
				.query(JdbcUserRepository::mapRow)
				.optional();
	}

	Optional<UserRecord> findById(UUID id) {
		return jdbc.sql(SELECT_USER + "WHERE id = :id")
				.param("id", id)
				.query(JdbcUserRepository::mapRow)
				.optional();
	}

	/// The number of rows changed: 0 when the user no longer exists.
	int updateLanguage(UUID id, String language, Instant now) {
		return jdbc.sql("UPDATE app_user SET language = :language, updated_at = :now WHERE id = :id")
				.param("language", language)
				.param("now", Timestamp.from(now))
				.param("id", id)
				.update();
	}

	private static UserRecord mapRow(ResultSet rs, int rowNum) throws SQLException {
		var roles = Arrays.stream((String[]) rs.getArray("roles").getArray()).map(Role::valueOf).toList();
		return new UserRecord(rs.getObject("id", UUID.class), rs.getString("email"), rs.getString("display_name"),
				rs.getString("password_hash"), roles, rs.getBoolean("enabled"),
				Language.valueOf(rs.getString("language")));
	}

	record UserRecord(UUID id, String email, String displayName, String passwordHash, List<Role> roles,
			boolean enabled, Language language) {
	}

}
