package app.retrofit.organization;

import java.util.List;
import java.util.UUID;

import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;

@RestController
@RequestMapping("/api/organizations")
@Tag(name = "organizations", description = "Customer organizations. Support sees all of them, a customer only "
		+ "their own.")
class OrganizationController {

	private final CallerLookup callers;

	private final OrganizationAccess access;

	OrganizationController(CallerLookup callers, OrganizationAccess access) {
		this.callers = callers;
		this.access = access;
	}

	@Operation(summary = "The organizations visible to the signed-in user, sorted by name ignoring case")
	@ApiResponse(responseCode = "200", description = "Support: every organization; customer: their own")
	@ApiResponse(responseCode = "401", description = "Problem type slug: auth/unauthenticated",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = @Schema(implementation = ProblemDetail.class)))
	@GetMapping
	List<Organization> listOrganizations(Authentication authentication) {
		return access.visibleTo(callers.current(authentication));
	}

	@Operation(summary = "One organization visible to the signed-in user")
	@ApiResponse(responseCode = "200", description = "The organization")
	@ApiResponse(responseCode = "400", description = "Problem type slug: malformed-request (id is not a UUID)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "401", description = "Problem type slug: auth/unauthenticated",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = @Schema(implementation = ProblemDetail.class)))
	@ApiResponse(responseCode = "404", description = "Problem type slug: organization/not-found "
			+ "(identical body for an unknown id and for another organization's id)",
			content = @Content(mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE, schema = @Schema(implementation = ProblemDetail.class)))
	@GetMapping("/{id}")
	Organization getOrganization(Authentication authentication, @PathVariable UUID id) {
		return access.get(callers.current(authentication), id);
	}

}
