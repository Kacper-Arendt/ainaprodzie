package app.retrofit.organization;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import java.util.UUID;

import io.swagger.v3.oas.annotations.media.Schema;

/// An enabled support account of a [Team], by its display name.
///
/// Public only because it is the type of [Team#members], a component of the public [Team].
public record TeamMember(@Schema(requiredMode = REQUIRED) UUID id, @Schema(requiredMode = REQUIRED) String name) {
}
