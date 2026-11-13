package app.retrofit.platform;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.yaml.snakeyaml.Yaml;

import app.retrofit.RandomPortContext;

/// Service metadata, read by the SPA before any session exists.
class MetaTests extends RandomPortContext {

	private static final String NO_STORE = "no-cache, no-store, max-age=0, must-revalidate";

	@Test
	void namesTheServiceAndItsFilteredVersionToAnonymousCallers() {
		var response = http().get().uri("/api/meta").retrieve()
				.toEntity(new ParameterizedTypeReference<Map<String, Object>>() {
				});

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody()).containsOnlyKeys("service", "apiVersion")
				.containsEntry("service", "retrofit")
				.containsEntry("apiVersion", "0.0.1-SNAPSHOT");
		assertThat(response.getBody().get("apiVersion")).isNotEqualTo("@project.version@");
		assertThat(response.getHeaders().getCacheControl()).isEqualTo(NO_STORE);
	}

	/// `@` is a YAML reserved indicator, so the placeholder only parses because it is quoted. A plain load of
	/// the source file is what an IDE run against `src/main/resources` sees, independent of Maven's resource
	/// filtering.
	@Test
	@SuppressWarnings("unchecked")
	void applicationYmlParsesUnfilteredWithTheQuotedVersionPlaceholder() throws Exception {
		var source = Files.readString(Path.of("src/main/resources/application.yml"), StandardCharsets.UTF_8);

		Map<String, Object> retrofit = null;
		for (Object loaded : new Yaml().loadAll(source)) {
			if (loaded instanceof Map<?, ?> document && document.containsKey("retrofit")) {
				retrofit = (Map<String, Object>) document.get("retrofit");
				break;
			}
		}

		assertThat(retrofit).isNotNull();
		assertThat(retrofit.get("api-version")).isEqualTo("@project.version@");
	}

}
