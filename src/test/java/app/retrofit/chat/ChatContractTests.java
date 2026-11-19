package app.retrofit.chat;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;

/// The chat in the exported contract, which the SPA's types are generated from: its paths, and the events as one
/// union the SPA can switch on by `type` (chat ADR 0004).
class ChatContractTests extends ChatServerContext {

	@Test
	void theChatPathsAreInTheContract() {
		var paths = apiDoc().get("paths");

		assertThat(paths.get("/api/chat/conversations/{conversationId}/messages").has("post")).isTrue();
		assertThat(paths.get("/api/chat/conversations/{conversationId}").has("delete")).isTrue();
		assertThat(paths.get("/api/chat/conversations/{conversationId}/messages").get("post").get("responses")
				.get("200").get("content").get("text/event-stream").get("schema").get("$ref").asString())
				.isEqualTo("#/components/schemas/ChatEvent");
	}

	@Test
	void chatEventIsAOneOfWithATypeDiscriminator() {
		var schemas = apiDoc().get("components").get("schemas");
		var event = schemas.get("ChatEvent");

		assertThat(event.get("oneOf").valueStream().map(ref -> ref.get("$ref").asString())).containsExactly(
				"#/components/schemas/ChatTokenEvent", "#/components/schemas/ChatDoneEvent",
				"#/components/schemas/ChatErrorEvent");
		assertThat(event.get("discriminator").get("propertyName").asString()).isEqualTo("type");
		assertThat(event.get("discriminator").get("mapping").get("error").asString())
				.isEqualTo("#/components/schemas/ChatErrorEvent");
		var error = schemas.get("ChatErrorEvent");
		assertThat(error.get("properties").get("type").get("enum").valueStream().map(JsonNode::asString))
				.containsExactly("error");
		assertThat(error.get("properties").get("code").get("enum").valueStream().map(JsonNode::asString))
				.containsExactly("rate-limited", "unavailable", "timeout", "personal-data-blocked", "failed");
		assertThat(error.get("required").valueStream().map(JsonNode::asString)).contains("type", "code");
	}

	/// The composer limits the question to the length the contract gives, rather than to a copy of the server's.
	@Test
	void theQuestionsLengthIsInTheContract() {
		var text = apiDoc().get("components").get("schemas").get("ChatMessageRequest").get("properties").get("text");

		assertThat(text.get("minLength").asInt()).isEqualTo(1);
		assertThat(text.get("maxLength").asInt()).isEqualTo(ChatController.TEXT_MAX);
	}

	private JsonNode apiDoc() {
		return JSON.readTree(http().get().uri("/v3/api-docs").retrieve().body(String.class));
	}

}
