package app.retrofit.organization;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;

import app.retrofit.RandomPortContext;
import app.retrofit.TestOrganizations;
import app.retrofit.TestUsers;
import app.retrofit.TestUsers.TestUser;
import app.retrofit.auth.Role;

/// `GET /api/teams`: support only, marking the caller's own team and listing its enabled support staff.
class TeamTests extends RandomPortContext {

	private static final String PROBLEMS = "https://retrofit.app/problems/";

	private static final ParameterizedTypeReference<Map<String, Object>> JSON_OBJECT = new ParameterizedTypeReference<>() {
	};

	private static final ParameterizedTypeReference<List<Map<String, Object>>> JSON_ARRAY = new ParameterizedTypeReference<>() {
	};

	@Autowired
	PasswordEncoder passwordEncoder;

	TestUsers users;

	TestOrganizations organizations;

	@BeforeEach
	void setUp() {
		users = new TestUsers(jdbc, passwordEncoder);
		organizations = new TestOrganizations(jdbc);
	}

	@Test
	void customerIsForbidden() {
		var customer = users.create(Role.USER);
		var session = login(customer.email(), customer.password());

		var response = http().get().uri("/api/teams")
				.header(HttpHeaders.COOKIE, "SESSION=" + session)
				.retrieve()
				.toEntity(JSON_OBJECT);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "auth/forbidden");
	}

	@Test
	void customerIsForbiddenOnTeamSubPathsToo() {
		var customer = users.create(Role.USER);
		var session = login(customer.email(), customer.password());

		var response = http().get().uri("/api/teams/" + UUID.randomUUID())
				.header(HttpHeaders.COOKIE, "SESSION=" + session)
				.retrieve()
				.toEntity(JSON_OBJECT);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "auth/forbidden");
	}

	@Test
	void supportSeesEveryTeamSortedByNameIgnoringCaseWithOnlyTheirOwnMarked() {
		var token = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
		var teamA = organizations.createTeam("alpha-" + token + "-");
		var teamB = organizations.createTeam("Bravo-" + token + "-");
		var support = users.create(Role.SUPPORT);
		organizations.moveSupport(support.id(), teamA);
		var session = login(support.email(), support.password());

		var response = list(session);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		var teams = response.getBody();
		var ids = teams.stream().map(team -> team.get("id")).toList();
		assertThat(ids).contains(teamA.toString(), teamB.toString());
		assertThat(ids.indexOf(teamA.toString())).isLessThan(ids.indexOf(teamB.toString()));
		assertThat(teams.get(ids.indexOf(teamA.toString()))).isEqualTo(expected(teamA, true, List.of(member(support.id(), "Test User"))));
		assertThat(teams.get(ids.indexOf(teamB.toString()))).isEqualTo(expected(teamB, false, List.of()));
	}

	@Test
	void eachTeamListsItsSupportStaffSortedByNameIgnoringCase() {
		var team = organizations.createTeam("Members-");
		var otherTeam = organizations.createTeam("Others-");
		var zed = supportIn(team, "zed Member");
		var anna = supportIn(team, "Anna Member");
		var bob = supportIn(team, "bob Member");
		var other = supportIn(otherTeam, "Other Member");
		var session = login(anna.email(), anna.password());

		var teams = list(session).getBody();

		assertThat(members(teams, team)).containsExactly(member(anna.id(), "Anna Member"),
				member(bob.id(), "bob Member"), member(zed.id(), "zed Member"));
		assertThat(members(teams, otherTeam)).containsExactly(member(other.id(), "Other Member"));
	}

	@Test
	void disabledSupportMemberIsNotListed() {
		var team = organizations.createTeam("Disabled-");
		var active = supportIn(team, "Active Member");
		var disabled = supportIn(team, "Disabled Member");
		users.disable(disabled.id());
		var session = login(active.email(), active.password());

		var teams = list(session).getBody();

		assertThat(members(teams, team)).containsExactly(member(active.id(), "Active Member"));
	}

	@Test
	void teamWithoutMembersAnswersAnEmptyList() {
		var team = organizations.createTeam("Empty-");
		var support = users.create(Role.SUPPORT);
		var session = login(support.email(), support.password());

		var teams = list(session).getBody();

		assertThat(members(teams, team)).isEmpty();
	}

	@Test
	void anonymousIsUnauthenticated() {
		var anonymous = http().get().uri("/api/teams").retrieve().toEntity(JSON_OBJECT);
		assertThat(anonymous.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(anonymous.getBody()).containsEntry("type", PROBLEMS + "auth/unauthenticated");
	}

	private ResponseEntity<List<Map<String, Object>>> list(String session) {
		return http().get().uri("/api/teams")
				.header(HttpHeaders.COOKIE, "SESSION=" + session)
				.retrieve()
				.toEntity(JSON_ARRAY);
	}

	private TestUser supportIn(UUID teamId, String displayName) {
		var support = users.create(Role.SUPPORT);
		organizations.moveSupport(support.id(), teamId);
		jdbc.sql("UPDATE app_user SET display_name = :displayName, updated_at = now() WHERE id = :id")
				.param("displayName", displayName)
				.param("id", support.id())
				.update();
		return support;
	}

	@SuppressWarnings("unchecked")
	private static List<Map<String, Object>> members(List<Map<String, Object>> teams, UUID teamId) {
		return teams.stream()
				.filter(team -> team.get("id").equals(teamId.toString()))
				.map(team -> (List<Map<String, Object>>) team.get("members"))
				.findFirst()
				.orElseThrow();
	}

	private static Map<String, Object> member(UUID id, String name) {
		return Map.of("id", id.toString(), "name", name);
	}

	private Map<String, Object> expected(UUID id, boolean member, List<Map<String, Object>> members) {
		return jdbc.sql("SELECT name, description FROM team WHERE id = :id")
				.param("id", id)
				.query((rs, rowNum) -> Map.<String, Object>of("id", id.toString(), "name", rs.getString("name"),
						"description", rs.getString("description"), "member", member, "members", members))
				.single();
	}

}
