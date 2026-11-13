package app.retrofit.platform;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;

/// One entry of the `errors[]` array in a 422 validation problem.
///
/// `code` is the stable, machine-readable contract clients branch on (e.g. `language.unknown`);
/// `message` is English developer-facing text that may be reworded at any time and must never be
/// pattern-matched.
public record FieldError(@Schema(requiredMode = REQUIRED) String field,
		@Schema(requiredMode = REQUIRED) String code,
		@Schema(requiredMode = REQUIRED) String message) {
}
