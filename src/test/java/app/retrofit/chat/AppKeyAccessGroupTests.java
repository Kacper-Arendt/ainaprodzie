package app.retrofit.chat;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

/// The app's virtual key reaches the aliases of one access group in LiteLLM's `config.yaml` (chat ADR 0002), so an
/// alias the app calls but the group misses answers 403.
class AppKeyAccessGroupTests {

	/// The group `litellm/app_key.py` gives the app's key.
	private static final String APP_GROUP = "app";

	@Test
	void everyAliasIsInTheAppsGroup() throws IOException {
		assertThat(entries()).isNotEmpty()
			.allSatisfy(entry -> assertThat(groups(entry)).as(alias(entry)).contains(APP_GROUP));
	}

	@SuppressWarnings("unchecked")
	private static List<Map<String, Object>> entries() throws IOException {
		Map<String, Object> config = new Yaml().load(Files.readString(Path.of("litellm", "config.yaml")));
		return (List<Map<String, Object>>) config.get("model_list");
	}

	private static String alias(Map<String, Object> entry) {
		return (String) entry.get("model_name");
	}

	@SuppressWarnings("unchecked")
	private static List<String> groups(Map<String, Object> entry) {
		var info = (Map<String, Object>) entry.getOrDefault("model_info", Map.of());
		return (List<String>) info.getOrDefault("access_groups", List.of());
	}

}
