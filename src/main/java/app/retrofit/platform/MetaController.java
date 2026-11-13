package app.retrofit.platform;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;

/// Service metadata, public because the SPA reads it before any session exists.
@RestController
@RequestMapping("/api/meta")
@Tag(name = "meta", description = "Public metadata about the retrofit service (no authentication).")
class MetaController {

	static final String SERVICE = "retrofit";

	private final String apiVersion;

	MetaController(@Value("${retrofit.api-version}") String apiVersion) {
		this.apiVersion = apiVersion;
	}

	@Operation(summary = "Metadata of the service, read before any session exists")
	@ApiResponse(responseCode = "200", description = "Service metadata")
	@GetMapping
	MetaResponse meta() {
		return new MetaResponse(SERVICE, apiVersion);
	}

	record MetaResponse(
			@Schema(requiredMode = REQUIRED, example = SERVICE,
					description = "Always retrofit: lets a client tell this service from a captive portal or proxy "
							+ "page answering the same path.") String service,
			@Schema(requiredMode = REQUIRED, example = "0.0.1-SNAPSHOT",
					description = "Version of this server build (the Maven project version).") String apiVersion) {
	}

}
