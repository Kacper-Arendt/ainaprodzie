package app.retrofit.organization;

import java.util.List;

import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;

/// Gated to SUPPORT by the security chain, not here.
@RestController
@RequestMapping("/api/teams")
@Tag(name = "teams", description = "Support teams, visible to support staff only.")
class TeamController {

	private final JdbcTeamRepository teams;

	TeamController(JdbcTeamRepository teams) {
		this.teams = teams;
	}

	@Operation(summary = "Every support team, sorted by name ignoring case, marking the signed-in user's own team "
			+ "and listing its enabled support staff")
	@ApiResponse(responseCode = "200", description = "Every support team with its members")
	@ApiResponse(responseCode = "401", description = "Problem type slug: auth/unauthenticated",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "403", description = "Problem type slug: auth/forbidden (caller without SUPPORT)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
					schema = @Schema(implementation = ProblemDetail.class)))
	@GetMapping
	List<Team> listTeams(Authentication authentication) {
		return teams.findAllWithMembership(CallerLookup.callerId(authentication));
	}

}
