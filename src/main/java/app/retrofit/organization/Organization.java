package app.retrofit.organization;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import java.util.UUID;

import io.swagger.v3.oas.annotations.media.Schema;

/// Public because the chat resolves organization names through [OrganizationAccess] from outside this package.
public record Organization(@Schema(requiredMode = REQUIRED) UUID id,
		@Schema(requiredMode = REQUIRED) String name,
		@Schema(requiredMode = REQUIRED) int firstResponseSlaMinutes) {
}
