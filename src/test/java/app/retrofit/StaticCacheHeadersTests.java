package app.retrofit;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

/// Cache headers on the served bundle: the shell and its deep links are never cached, content-hashed assets are
/// cached forever once they are actually served. A real server rather than MockMvc, because a deep link is a forward
/// and MockMvc does not execute forwards.
class StaticCacheHeadersTests extends RandomPortContext {

	private static final String NO_STORE = "no-cache, no-store, max-age=0, must-revalidate";

	private static final String IMMUTABLE = "public, max-age=31536000, immutable";

	@Test
	void theShellAndItsDeepLinksAreNeverCached() {
		for (String path : List.of("/", "/index.html", "/login")) {
			var response = get(path);

			assertThat(response.getStatusCode().value()).as("status of %s", path).isEqualTo(200);
			assertThat(response.getHeaders().getCacheControl()).as("Cache-Control of %s", path).isEqualTo(NO_STORE);
		}
	}

	@Test
	void hashedAssetsAreCachedForeverWhileTheApiStaysUncached() {
		var asset = get("/assets/index-deadbeef.js");
		assertThat(asset.getStatusCode().value()).isEqualTo(200);
		assertThat(asset.getHeaders().getCacheControl()).isEqualTo(IMMUTABLE);

		var meta = get("/api/meta");
		assertThat(meta.getStatusCode().value()).isEqualTo(200);
		assertThat(meta.getHeaders().getCacheControl()).isEqualTo(NO_STORE);
	}

	@Test
	void aMissingAssetIsNeverCached() {
		var missing = get("/assets/index-0ldhash.js");

		assertThat(missing.getStatusCode().value()).isEqualTo(404);
		assertThat(missing.getHeaders().getCacheControl()).isEqualTo(NO_STORE);
	}

	private ResponseEntity<String> get(String uri) {
		return http().get().uri(uri).retrieve().toEntity(String.class);
	}

}
