package app.retrofit.chat;

import static app.retrofit.chat.ScriptedChatModel.answer;
import static io.opentelemetry.api.common.AttributeKey.stringKey;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;

import app.retrofit.auth.Role;
import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.data.SpanData;
import tools.jackson.databind.JsonNode;

/// The trace of a question as it leaves the app (chat ADR 0007): one trace with the HTTP request at its root, a span for
/// the model call carrying the prompt's version and the texts, and nothing of other requests.
class ChatTracingTests extends ChatServerContext {

	private static final String QUESTION = "Hello, what can you do?";

	private static final String ANSWER = "I explain how the help desk works.";

	@Autowired
	InMemorySpanExporter exported;

	@Autowired
	SdkTracerProvider tracerProvider;

	@Autowired
	SystemPrompt systemPrompt;

	@Autowired
	ChatSettingStore settings;

	@BeforeEach
	void forgetEarlierSpans() {
		settings.change(new ChatSettingsChange(true, false, true, "chat-gemini"));
		tracerProvider.forceFlush().join(5, TimeUnit.SECONDS);
		exported.reset();
	}

	@Test
	void aQuestionIsOneTraceWhoseModelCallSpanCarriesThePromptVersionAndTheTexts() {
		var customer = users.create(Role.USER);
		var session = login(customer);
		var conversationId = UUID.randomUUID();
		model.script(answer(ANSWER));

		var reply = ask(session, conversationId, QUESTION);

		assertThat(reply.names()).last().isEqualTo("done");
		var spans = questionTrace();
		var modelCalls = spans.stream().filter(span -> "chat".equals(operation(span))).toList();
		assertThat(modelCalls).hasSize(1);
		assertThat(spans).extracting(SpanData::getTraceId).containsOnly(httpRequest(spans).getTraceId());
		assertThat(httpRequest(spans).getResource().getAttribute(stringKey("openinference.project.name")))
				.isEqualTo("retrofit");
		assertThat(spans).allSatisfy(span -> assertThat(span == httpRequest(spans)
				|| span.getAttributes().get(stringKey("spring.ai.kind")) != null
				|| operation(span) != null).as("%s is the request or a Spring AI span", span.getName()).isTrue());
		assertThat(text(httpRequest(spans), "openinference.span.kind")).isEqualTo("CHAIN");
		var modelCall = modelCalls.getFirst();
		assertThat(text(modelCall, "openinference.span.kind")).isEqualTo("LLM");
		assertThat(text(modelCall, "retrofit.prompt.name")).isEqualTo("chat-system");
		assertThat(text(modelCall, "retrofit.prompt.version")).isEqualTo(systemPrompt.version()).hasSize(12);
		assertThat(text(modelCall, "session.id")).isEqualTo(conversationId.toString());
		assertThat(text(modelCall, "user.id")).isEqualTo(customer.id().toString());

		var input = json(modelCall, "gen_ai.input.messages");
		assertThat(input.get(0).get("role").asString()).isEqualTo("system");
		assertThat(input.get(0).get("parts").get(0).get("content").asString()).isEqualTo(systemPrompt.text());
		assertThat(input.get(1).get("role").asString()).isEqualTo("user");
		assertThat(input.get(1).get("parts").get(0).get("content").asString()).endsWith(QUESTION);
		var answerMessage = json(modelCall, "gen_ai.output.messages").get(0);
		assertThat(answerMessage.get("role").asString()).isEqualTo("assistant");
		assertThat(answerMessage.get("parts").get(0).get("content").asString()).isEqualTo(ANSWER);
		assertThat(answerMessage.has("finish_reason")).isTrue();
	}

	@Test
	void withTheSwitchOffAQuestionExportsNoSpan() {
		var session = login(users.create(Role.USER));
		settings.change(new ChatSettingsChange(false, false, true, "chat-gemini"));
		model.script(answer(ANSWER));

		var reply = ask(session, QUESTION);

		assertThat(reply.names()).last().isEqualTo("done");
		await().during(Duration.ofSeconds(1)).atMost(Duration.ofSeconds(3)).untilAsserted(() -> {
			tracerProvider.forceFlush().join(5, TimeUnit.SECONDS);
			assertThat(exported.getFinishedSpanItems()).isEmpty();
		});
	}

	@Test
	void aRequestForTheChatSettingsIsNotTraced() {
		var session = login(users.create(Role.SUPPORT));
		var settingsRead = http().get().uri("/api/chat/settings")
				.header(HttpHeaders.COOKIE, "SESSION=" + session)
				.retrieve()
				.toBodilessEntity();
		assertThat(settingsRead.getStatusCode()).isEqualTo(HttpStatus.OK);
		model.script(answer(ANSWER));

		ask(session, QUESTION);

		assertThat(questionTrace()).noneSatisfy(span -> assertThat(text(span, "uri")).isEqualTo("/api/chat/settings"));
	}

	/// The spans exported since the test began, once the question's HTTP request is among them: the request span
	/// ends when the stream completes, which can be just after the client read its last event.
	private List<SpanData> questionTrace() {
		await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
			tracerProvider.forceFlush().join(5, TimeUnit.SECONDS);
			assertThat(exported.getFinishedSpanItems()).anySatisfy(span -> assertThat(isChatRequest(span)).isTrue());
		});
		return exported.getFinishedSpanItems();
	}

	private static SpanData httpRequest(List<SpanData> spans) {
		return spans.stream().filter(ChatTracingTests::isChatRequest).findFirst().orElseThrow();
	}

	private static boolean isChatRequest(SpanData span) {
		return "/api/chat/conversations/{conversationId}/messages".equals(text(span, "uri"));
	}

	private static String operation(SpanData span) {
		return text(span, "gen_ai.operation.name");
	}

	private static String text(SpanData span, String key) {
		return span.getAttributes().get(stringKey(key));
	}

	private static JsonNode json(SpanData span, String key) {
		return JSON.readTree(text(span, key));
	}

}
