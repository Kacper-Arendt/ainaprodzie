package app.retrofit;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

/// Content types on the served bundle. A real server rather than MockMvc, because the type is decided by the servlet
/// container's MIME table and MockMvc has no container.
class StaticContentTypeTests extends RandomPortContext {

	@Test
	void theManifestIsServedAsAManifestAndTheShellAsHtml() {
		var manifest = http().get().uri("/manifest.webmanifest").retrieve().toEntity(String.class);
		var shell = http().get().uri("/index.html").retrieve().toEntity(String.class);

		assertThat(manifest.getStatusCode().value()).isEqualTo(200);
		assertThat(manifest.getHeaders().getContentType()).as("Content-Type of /manifest.webmanifest")
				.matches(type -> type.isCompatibleWith(MediaType.parseMediaType("application/manifest+json")));
		assertThat(shell.getHeaders().getContentType()).as("Content-Type of /index.html")
				.matches(type -> type.isCompatibleWith(MediaType.TEXT_HTML));
	}

}
