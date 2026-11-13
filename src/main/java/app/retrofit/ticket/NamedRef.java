package app.retrofit.ticket;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import java.util.UUID;

import io.swagger.v3.oas.annotations.media.Schema;

record NamedRef(@Schema(requiredMode = REQUIRED) UUID id, @Schema(requiredMode = REQUIRED) String name) {
}
