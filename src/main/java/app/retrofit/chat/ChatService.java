package app.retrofit.chat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import app.retrofit.organization.Caller;
import app.retrofit.organization.CallerLookup;
import app.retrofit.organization.OrganizationAccess;
import app.retrofit.organization.Team;
import io.micrometer.tracing.Tracer;
import io.micrometer.tracing.propagation.Propagator;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/// Answers one question of the signed-in user as a stream of [ChatEvent]s. The model has no tools: it answers from the
/// system prompt, the conversation and the context block alone.
///
/// The question goes to the model behind a context block (who is signed in, the current time, the interface
/// language), so the system prompt stays the same for every request (chat ADR 0008). The conversation remembers the
/// question without that block and the final answer, and only once the answer is complete: a failed or cancelled turn
/// leaves it as it was (chat ADR 0005). A conversation nobody asks in for `retrofit.chat.conversation-idle-timeout`
/// is forgotten as if it were deleted, so what was said in it does not stay in the process until a restart.
///
/// A turn has one deadline, `retrofit.chat.turn-timeout`; past it the turn ends as `timeout`, like a model call past
/// the client's timeout.
///
/// The conversation id, the caller's id and the stored `appLlmSpansExported` go into the advisor context too, where Spring
/// AI and [ChatTraceContentFilter] read them for the trace (chat ADR 0007, 0016). No advisor reads memory from it: the memory key
/// also holds the user.
///
/// Every model call of a question carries the prompt's name and version and the conversation id as request metadata,
/// and the caller's id as the request's `user`, which LiteLLM puts on its own spans and counts spend by. While the app
/// exports its traces, each also carries the `traceparent` of the question's request, so LiteLLM's spans join the
/// question's trace; [OpenModelCalls] then rewrites it to the model call's own span as the call goes out.
@Service
class ChatService {

	private static final Logger log = LoggerFactory.getLogger(ChatService.class);

	/// The advisor context key of the caller's id.
	static final String CALLER_ID = "retrofit_caller_id";

	/// The advisor context key that says whether the question's model spans are LLM spans with the calls' tokens.
	static final String LLM_SPANS_EXPORTED = "retrofit_llm_spans_exported";

	private final ChatClient chatClient;

	private final ChatMemory memory;

	private final CallerLookup callers;

	private final OrganizationAccess organizations;

	private final Clock clock;

	private final SystemPrompt systemPrompt;

	private final ChatSettingStore settings;

	private final Tracer tracer;

	private final Propagator propagator;

	private final Duration turnTimeout;

	private final Duration idleTimeout;

	/// What the process holds of each conversation besides its memory, by its memory key: it lives as long as its
	/// memory.
	private final Map<String, Conversation> conversations = new ConcurrentHashMap<>();

	ChatService(ChatClient chatClient, ChatMemory memory, CallerLookup callers, OrganizationAccess organizations,
			Clock clock, SystemPrompt systemPrompt, ChatSettingStore settings,
			Tracer tracer, Propagator propagator,
			@Value("${retrofit.chat.turn-timeout}") Duration turnTimeout,
			@Value("${retrofit.chat.conversation-idle-timeout}") Duration idleTimeout) {
		if (!turnTimeout.isPositive()) {
			throw new IllegalArgumentException("retrofit.chat.turn-timeout must be positive, was " + turnTimeout);
		}
		if (idleTimeout.compareTo(turnTimeout) <= 0) {
			throw new IllegalArgumentException("retrofit.chat.conversation-idle-timeout must be longer than "
					+ "retrofit.chat.turn-timeout (" + turnTimeout + "), was " + idleTimeout);
		}
		this.chatClient = chatClient;
		this.memory = memory;
		this.callers = callers;
		this.organizations = organizations;
		this.clock = clock;
		this.systemPrompt = systemPrompt;
		this.settings = settings;
		this.tracer = tracer;
		this.propagator = propagator;
		this.turnTimeout = turnTimeout;
		this.idleTimeout = idleTimeout;
	}

	/// One question in a conversation, asked in the user interface's `language`.
	record Question(UUID callerId, UUID conversationId, InterfaceLanguage language, String text) {
	}

	/// One conversation from its first question until it is forgotten, and when its latest question arrived. A
	/// conversation forgotten and started afresh under the same key is a different `started`.
	private record Conversation(Object started, Instant lastQuestion) {
	}

	/// Who is signed in is resolved here, once for the whole question, before the stream starts: a caller refused by
	/// [CallerLookup] gets an ordinary 401 rather than an `error` event.
	Flux<ChatEvent> ask(Question question) {
		var key = key(question.callerId(), question.conversationId());
		var caller = callers.current(question.callerId());
		var contextBlock = contextBlock(caller, question);
		var current = settings.settings();
		var options = modelRequest(question, current);
		return Flux.defer(() -> {
			var started = conversations.compute(key, (_, held) -> new Conversation(
					held == null ? new Object() : held.started(), clock.instant())).started();
			var text = question.text();
			var answer = new Answer();
			var deadline = Mono.delay(turnTimeout).cache();
			return chatClient.prompt()
					.messages(memory.get(key))
					.user(contextBlock + text)
					.options(options)
					.advisors(advisors -> advisors.param(ChatMemory.CONVERSATION_ID, question.conversationId().toString())
							.param(CALLER_ID, question.callerId().toString())
							.param(LLM_SPANS_EXPORTED, current.appLlmSpansExported()))
					.stream()
					.chatResponse()
					.timeout(deadline, _ -> deadline)
					.concatMapIterable(response -> answer.append(text(response)))
					.concatWith(Flux.defer(() -> complete(key, started, text, answer)));
		}).onErrorResume(failure -> Flux.just(failed(key, failure)));
	}

	/// Forgets one conversation of the caller; another user's conversation with the same id is a different one.
	void forget(UUID callerId, UUID conversationId) {
		var key = key(callerId, conversationId);
		conversations.compute(key, (_, _) -> {
			memory.clear(key);
			return null;
		});
	}

	/// Forgets every conversation whose latest question arrived `retrofit.chat.conversation-idle-timeout` or longer
	/// before `now`. Its memory is cleared while the map holds its key, so a question arriving meanwhile either keeps
	/// the conversation or starts it afresh.
	void forgetIdle(Instant now) {
		var forgotten = new AtomicInteger();
		conversations.keySet().forEach(key -> conversations.computeIfPresent(key, (_, conversation) -> {
			if (conversation.lastQuestion().plus(idleTimeout).isAfter(now)) {
				return conversation;
			}
			memory.clear(key);
			forgotten.incrementAndGet();
			return null;
		}));
		if (forgotten.get() > 0) {
			log.info("Forgot {} idle conversations", forgotten.get());
		}
	}

	/// A conversation is forgotten at most a minute after its idle timeout.
	@Scheduled(fixedDelay = 1, timeUnit = TimeUnit.MINUTES)
	void forgetIdleConversations() {
		forgetIdle(clock.instant());
	}

	/// The options of every model call of the question, sent to the stored model. The `traceparent` is written here, on the request's thread,
	/// where the question's request span is current; a question asked outside a request sends none.
	private OpenAiChatOptions.Builder modelRequest(Question question, ChatSettings current) {
		var headers = new HashMap<String, String>();
		var span = tracer.currentTraceContext().context();
		if (span != null && current.traceparentSent()) {
			propagator.inject(span, headers, Map::put);
		}
		return OpenAiChatOptions.builder()
				.model(current.model())
				.metadata(Map.of("prompt_name", systemPrompt.name(), "prompt_version", systemPrompt.version(),
						"conversation_id", question.conversationId().toString()))
				.user(question.callerId().toString())
				.customHeaders(headers);
	}

	/// The memory key: the session's user decides whose conversation a request reaches, never the request alone.
	private static String key(UUID callerId, UUID conversationId) {
		return callerId + ":" + conversationId;
	}

	private String contextBlock(Caller caller, Question question) {
		return """
				<context>
				Signed in: %s
				Current time: %s
				Interface language: %s
				</context>
				""".formatted(signedIn(caller), clock.instant().truncatedTo(ChronoUnit.SECONDS),
				question.language().tag());
	}

	private String signedIn(Caller caller) {
		return switch (caller) {
			case Caller.Customer _ ->
				"a customer of the organization " + organizations.visibleTo(caller).getFirst().name();
			case Caller.Support _ -> "support staff in the " + organizations.teamsVisibleTo(caller)
					.stream()
					.filter(Team::member)
					.map(Team::name)
					.findFirst()
					.orElseThrow() + " team";
		};
	}

	private static String text(ChatResponse response) {
		var text = new StringBuilder();
		for (Generation generation : response.getResults()) {
			if (generation.getOutput().getText() != null) {
				text.append(generation.getOutput().getText());
			}
		}
		return text.toString();
	}

	/// A conversation forgotten while its answer streamed, deleted or idle, does not remember the turn, even when a
	/// question asked meanwhile started it afresh. The turn is remembered while the map holds its key, so forgetting the
	/// conversation never runs between the check and the write.
	private Flux<ChatEvent> complete(String key, Object started, String question, Answer answer) {
		if (!answer.started()) {
			throw new ChatErrors.UnusableAnswer("The answer has no letter or digit");
		}
		conversations.computeIfPresent(key, (_, held) -> {
			if (held.started() == started) {
				memory.add(key, List.of(new UserMessage(question), new AssistantMessage(answer.text())));
			}
			return held;
		});
		return Flux.fromIterable(answer.rest()).concatWith(Flux.just(new ChatEvent.Done()));
	}

	/// Logged once, with the conversation key and the cause as a [RedactedFailure], never with the question or the
	/// answer.
	private static ChatEvent failed(String key, Throwable failure) {
		var code = ChatErrors.code(failure);
		log.warn("Chat answer failed with {} in conversation {}", code, key, RedactedFailure.of(failure));
		return new ChatEvent.Error(code);
	}

	/// The answer so far, as the model wrote it. Text is held back until it has a letter or a digit, so a degenerate
	/// answer such as `:` never reaches the user and ends as `failed`, like an empty one.
	private static final class Answer {

		private final StringBuilder text = new StringBuilder();

		private int sent;

		private boolean started;

		List<ChatEvent> append(String chunk) {
			text.append(chunk);
			if (!started && text.codePoints().noneMatch(Character::isLetterOrDigit)) {
				return List.of();
			}
			started = true;
			return rest();
		}

		/// What is still held back.
		List<ChatEvent> rest() {
			if (text.length() <= sent) {
				return List.of();
			}
			var piece = text.substring(sent);
			sent = text.length();
			return List.of(new ChatEvent.Token(piece));
		}

		boolean started() {
			return started;
		}

		String text() {
			return text.toString();
		}

	}

}
