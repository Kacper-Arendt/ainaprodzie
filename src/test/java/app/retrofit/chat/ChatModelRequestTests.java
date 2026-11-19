package app.retrofit.chat;

import static app.retrofit.chat.StubModelServer.answerStream;
import static io.opentelemetry.api.common.AttributeKey.stringKey;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.TestPropertySource;

import app.retrofit.RandomPortContext;
import app.retrofit.TestUsers;
import app.retrofit.TestUsers.TestUser;
import app.retrofit.auth.Role;
import app.retrofit.chat.ChatServerContext.Reply;
import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.data.SpanData;
import tools.jackson.databind.json.JsonMapper;

/// What each model call of a question sends to LiteLLM: the metadata that finds it in LiteLLM's traces, and, while the
/// app exports its traces, the `traceparent` that puts LiteLLM's span under the app's span of that model call. The real
/// OpenAI client streams an answer from [StubModelServer], so a question makes one model call.
// Spring Boot propagates the trace context only while export is enabled; the OTLP exporter stays off.
@TestPropertySource(properties = { "spring.ai.model.chat=openai", "management.tracing.export.enabled=true",
		"management.tracing.export.otlp.enabled=false" })
@Import(StubModelServer.Wiring.class)
class ChatModelRequestTests extends RandomPortContext {

	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static final String USAGE = "{\"prompt_tokens\":1200,\"completion_tokens\":8,\"total_tokens\":1208}";

	@Autowired
	StubModelServer modelServer;

	@Autowired
	InMemorySpanExporter exported;

	@Autowired
	SdkTracerProvider tracerProvider;

	@Autowired
	PasswordEncoder passwordEncoder;

	@Autowired
	ChatSettingStore settings;

	@Autowired
	SystemPrompt systemPrompt;

	@Autowired
	ChatService chat;

	TestUser customer;

	@BeforeEach
	void scriptAnAnswer() {
		tracerProvider.forceFlush().join(5, TimeUnit.SECONDS);
		exported.reset();
		modelServer.script(answerStream("Hello! How can I help?", USAGE));
		customer = new TestUsers(jdbc, passwordEncoder).create(Role.USER);
	}

	@Test
	void everyModelCallCarriesThePromptAndTheConversationAsMetadataAndTheCallerAsItsUser() {
		settings.change(new ChatSettingsChange(false, false, true, "chat-gemini"));
		var conversationId = UUID.randomUUID();

		var reply = ask(conversationId);

		assertThat(reply.names()).last().isEqualTo("done");
		assertThat(modelServer.requests()).hasSize(1).allSatisfy(request -> {
			var body = JSON.readTree(request.body());
			assertThat(body.get("model").asString()).isEqualTo("chat-gemini");
			assertThat(JSON.convertValue(body.get("metadata"), Map.class)).isEqualTo(Map.of(
					"prompt_name", "chat-system",
					"prompt_version", systemPrompt.version(),
					"conversation_id", conversationId.toString()));
			assertThat(body.get("user").asString()).isEqualTo(customer.id().toString());
		});
	}

	@Test
	void everyModelCallGoesToTheStoredModel() {
		settings.change(new ChatSettingsChange(false, false, true, "chat-anthropic"));

		ask(UUID.randomUUID());

		assertThat(modelServer.requests()).hasSize(1).allSatisfy(request -> assertThat(
				JSON.readTree(request.body()).get("model").asString()).isEqualTo("chat-anthropic"));
	}

	@Test
	void withTheSwitchOnEachModelCallCarriesATraceparentWhoseParentIsItsOwnModelSpan() {
		settings.change(new ChatSettingsChange(true, false, true, "chat-gemini"));

		var reply = ask(UUID.randomUUID());

		assertThat(reply.names()).last().isEqualTo("done");
		var request = questionRequest();
		var modelSpans = exported.getFinishedSpanItems().stream()
				.filter(span -> "chat".equals(span.getAttributes().get(stringKey("gen_ai.operation.name"))))
				.map(span -> "00-" + span.getTraceId() + "-" + span.getSpanId())
				.toList();
		// The trace flags are the request span's sampling decision, not part of the parent.
		var traceparents = modelServer.requests().stream()
				.map(each -> each.header("traceparent").substring(0, "00-".length() + 32 + 1 + 16))
				.toList();
		assertThat(modelSpans).hasSize(1).allSatisfy(span -> assertThat(span).contains(request.getTraceId()));
		assertThat(traceparents).containsExactlyInAnyOrderElementsOf(modelSpans);
	}

	@Test
	void withTheSwitchOffNoModelCallCarriesATraceparent() {
		settings.change(new ChatSettingsChange(false, false, true, "chat-gemini"));

		var reply = ask(UUID.randomUUID());

		assertThat(reply.names()).last().isEqualTo("done");
		assertThat(modelServer.requests()).hasSize(1)
				.allSatisfy(request -> assertThat(request.header("traceparent")).isNull());
	}

	/// LiteLLM's calls then carry the question's trace, though the app exports none of its spans.
	@Test
	void withOnlyTheGatewayJoinedTheModelCallCarriesATraceparent() {
		settings.change(new ChatSettingsChange(false, true, true, "chat-gemini"));

		var reply = ask(UUID.randomUUID());

		assertThat(reply.names()).last().isEqualTo("done");
		var traceIds = modelServer.requests().stream().map(each -> each.header("traceparent"))
				.map(traceparent -> traceparent == null ? null : traceparent.split("-")[1])
				.toList();
		assertThat(traceIds).hasSize(1).doesNotContainNull();
	}

	/// A question asked of [ChatService] directly, outside any request.
	@Test
	void withoutACurrentSpanNoModelCallCarriesATraceparent() {
		settings.change(new ChatSettingsChange(true, false, true, "chat-gemini"));

		var events = chat.ask(new ChatService.Question(customer.id(), UUID.randomUUID(), InterfaceLanguage.EN,
				"Hello")).collectList().block(Duration.ofSeconds(10));

		assertThat(events).last().isInstanceOf(ChatEvent.Done.class);
		assertThat(modelServer.requests()).hasSize(1)
				.allSatisfy(request -> assertThat(request.header("traceparent")).isNull());
	}

	private Reply ask(UUID conversationId) {
		var session = login(customer.email(), customer.password());
		var csrf = primeCsrf();
		var response = http().post().uri("/api/chat/conversations/{conversationId}/messages", conversationId)
				.header("X-XSRF-TOKEN", csrf.header())
				.header(HttpHeaders.COOKIE, csrf.cookie() + "; SESSION=" + session)
				.contentType(MediaType.APPLICATION_JSON)
				.body(Map.of("text", "Hello"))
				.retrieve()
				.toEntity(String.class);
		return new Reply(response.getStatusCode(), response.getHeaders().getContentType(),
				response.getBody() == null ? "" : response.getBody());
	}

	/// The span of the question's HTTP request, once exported: it ends when the stream completes.
	private SpanData questionRequest() {
		await().atMost(Duration.ofSeconds(10)).untilAsserted(() -> {
			tracerProvider.forceFlush().join(5, TimeUnit.SECONDS);
			assertThat(exported.getFinishedSpanItems()).anySatisfy(span -> assertThat(isQuestionRequest(span)).isTrue());
		});
		return exported.getFinishedSpanItems().stream().filter(ChatModelRequestTests::isQuestionRequest).findFirst()
				.orElseThrow();
	}

	private static boolean isQuestionRequest(SpanData span) {
		return "/api/chat/conversations/{conversationId}/messages".equals(span.getAttributes().get(stringKey("uri")));
	}

}
