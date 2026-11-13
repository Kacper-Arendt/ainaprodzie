package app.retrofit.organization;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import java.util.List;
import java.util.UUID;

import io.swagger.v3.oas.annotations.media.Schema;

record Team(@Schema(requiredMode = REQUIRED) UUID id,
		@Schema(requiredMode = REQUIRED) String name,
		@Schema(requiredMode = REQUIRED) String description,
		@Schema(requiredMode = REQUIRED, description = "true when this is the signed-in user's team") boolean member,
		@Schema(requiredMode = REQUIRED,
				description = "The team's enabled support staff, sorted by name ignoring case") List<TeamMember> members) {
}
