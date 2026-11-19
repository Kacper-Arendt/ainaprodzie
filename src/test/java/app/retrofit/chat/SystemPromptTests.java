package app.retrofit.chat;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;

/// The prompt's version is a digest of its text (chat ADR 0008): the same text has the same version, and any change
/// gives a new one by itself.
class SystemPromptTests {

	@Test
	void theVersionIsTheFirstTwelveHexDigitsOfTheTextsDigest() {
		var prompt = SystemPrompt.read("chat-system", resource("You are the assistant."));

		assertThat(prompt.text()).isEqualTo("You are the assistant.");
		assertThat(prompt.version()).matches("[0-9a-f]{12}");
		assertThat(SystemPrompt.read("chat-system", resource("You are the assistant.")).version())
				.isEqualTo(prompt.version());
		assertThat(SystemPrompt.read("chat-system", resource("You are the assistant!")).version())
				.isNotEqualTo(prompt.version());
	}

	private static ByteArrayResource resource(String text) {
		return new ByteArrayResource(text.getBytes(StandardCharsets.UTF_8));
	}

}
