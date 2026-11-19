package app.retrofit.chat;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClientRequest;
import org.springframework.ai.chat.client.observation.ChatClientObservationContext;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.observation.ChatModelObservationContext;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.model.tool.ToolCallingChatOptions;
import org.springframework.core.io.ByteArrayResource;

import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationHandler;
import io.micrometer.observation.ObservationRegistry;
import tools.jackson.databind.json.JsonMapper;

/// A model call span names no model: LiteLLM's own spans name the provider model, and Phoenix prices those.
class ChatTraceContentFilterTests {

	private final List<Observation.Context> stopped = new CopyOnWriteArrayList<>();

	@Test
	void aModelCallSpanNamesNoLlmModelName() {
		var modelCall = modelCall("chat-gemini");

		assertThat(modelCall.getHighCardinalityKeyValue("llm.model_name")).isNull();
	}

	@Test
	void aQuestionsSpansCarryTheirOpenInferenceKind() {
		var modelCall = modelCall("chat-gemini");
		var question = stopped.stream().filter(ChatClientObservationContext.class::isInstance).findFirst().orElseThrow();

		assertThat(modelCall.getHighCardinalityKeyValue("openinference.span.kind").getValue()).isEqualTo("LLM");
		assertThat(question.getHighCardinalityKeyValue("openinference.span.kind").getValue()).isEqualTo("CHAIN");
	}

	/// One model call of a chat question through `alias`, as the chat client and the model observe it.
	private Observation.Context modelCall(String alias) {
		var systemPrompt = SystemPrompt.read("chat-system", new ByteArrayResource("You answer.".getBytes()));
		var registry = ObservationRegistry.create();
		registry.observationConfig()
				.observationFilter(new ChatTraceContentFilter(systemPrompt, JsonMapper.builder().build()))
				.observationHandler(new Recorder());
		var prompt = new Prompt("Which tickets are new?", ToolCallingChatOptions.builder().model(alias).build());
		var question = Observation.createNotStarted("spring.ai.chat.client",
				() -> ChatClientObservationContext.builder()
						.request(ChatClientRequest.builder().prompt(prompt)
								.context(ChatMemory.CONVERSATION_ID, "a-conversation")
								.build())
						.build(),
				registry).start();
		Observation.createNotStarted("gen_ai.client.operation",
				() -> ChatModelObservationContext.builder().prompt(prompt).provider("openai").build(), registry)
				.parentObservation(question)
				.start()
				.stop();
		question.stop();
		return stopped.stream().filter(ChatModelObservationContext.class::isInstance).findFirst().orElseThrow();
	}

	private final class Recorder implements ObservationHandler<Observation.Context> {

		@Override
		public boolean supportsContext(Observation.Context context) {
			return true;
		}

		@Override
		public void onStop(Observation.Context context) {
			stopped.add(context);
		}

	}

}
