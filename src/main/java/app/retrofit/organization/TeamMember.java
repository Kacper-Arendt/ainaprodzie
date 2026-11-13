package app.retrofit.organization;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import java.util.UUID;

import io.swagger.v3.oas.annotations.media.Schema;

/// An enabled support account of a [Team], by its display name.
record TeamMember(@Schema(requiredMode = REQUIRED) UUID id, @Schema(requiredMode = REQUIRED) String name) {
}
