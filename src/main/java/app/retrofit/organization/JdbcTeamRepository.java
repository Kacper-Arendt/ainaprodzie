package app.retrofit.organization;

import static java.util.stream.Collectors.groupingBy;
import static java.util.stream.Collectors.mapping;
import static java.util.stream.Collectors.toList;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
class JdbcTeamRepository {

	private final JdbcClient jdbc;

	JdbcTeamRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	List<Team> findAllWithMembership(UUID userId) {
		var membersByTeam = findMembersByTeam();
		return jdbc.sql("""
				SELECT t.id, t.name, t.description,
					EXISTS (SELECT 1 FROM app_user u WHERE u.id = :userId AND u.team_id = t.id) AS member
				FROM team t
				ORDER BY lower(t.name)
				""")
				.param("userId", userId)
				.query((rs, rowNum) -> {
					var id = rs.getObject("id", UUID.class);
					return new Team(id, rs.getString("name"), rs.getString("description"), rs.getBoolean("member"),
							membersByTeam.getOrDefault(id, List.of()));
				})
				.list();
	}

	/// One query for every team, so the listing costs two queries however many teams there are.
	private Map<UUID, List<TeamMember>> findMembersByTeam() {
		return jdbc.sql("""
				SELECT team_id, id, display_name
				FROM app_user
				WHERE enabled AND team_id IS NOT NULL AND 'SUPPORT' = ANY (roles)
				ORDER BY lower(display_name), id
				""")
				.query((rs, rowNum) -> new MemberRow(rs.getObject("team_id", UUID.class),
						new TeamMember(rs.getObject("id", UUID.class), rs.getString("display_name"))))
				.list()
				.stream()
				.collect(groupingBy(MemberRow::teamId, mapping(MemberRow::member, toList())));
	}

	private record MemberRow(UUID teamId, TeamMember member) {
	}

}
