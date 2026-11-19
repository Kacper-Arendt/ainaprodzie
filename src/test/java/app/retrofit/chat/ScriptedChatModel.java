package app.retrofit.chat;

import java.time.Duration;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CopyOnWriteArrayList;

import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.model.MessageAggregator;
import org.springframework.ai.chat.observation.ChatModelObservationContext;
import org.springframework.ai.chat.observation.ChatModelObservationDocumentation;
import org.springframework.ai.chat.observation.DefaultChatModelObservationConvention;
import org.springframework.ai.chat.prompt.ChatOptions;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.model.tool.ToolCallingChatOptions;

import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationRegistry;
import io.micrometer.observation.contextpropagation.ObservationThreadLocalAccessor;
import reactor.core.publisher.Flux;

/// The `ChatModel` of the regular tests: it replays a script instead of calling a model, and records every prompt it
/// is sent. Each step of the script answers one model call.
///
/// The chat only streams, so `stream` replays the script, and an answer arrives word by word, as a model's would. The
/// options are the ones Spring AI's own models default to. Each call is observed as Spring AI's models observe theirs,
/// so the trace of a question has its model call spans.
final class ScriptedChatModel implements ChatModel {

	private static final DefaultChatModelObservationConvention CONVENTION = new DefaultChatModelObservationConvention();

	private final ObservationRegistry observations;

	/// One model call's response.
	@FunctionalInterface
	interface Step {

		Flux<ChatResponse> respond();

	}

	private final Queue<Step> script = new ConcurrentLinkedQueue<>();

	private final List<Prompt> prompts = new CopyOnWriteArrayList<>();

	ScriptedChatModel(ObservationRegistry observations) {
		this.observations = observations;
	}

	/// Replaces the script and forgets the prompts recorded so far.
	void script(Step... steps) {
		script.clear();
		prompts.clear();
		script.addAll(List.of(steps));
	}

	/// A step that answers `text`, streamed word by word.
	static Step answer(String text) {
		return () -> Flux.fromArray(text.split("(?<= )")).map(word -> response(new AssistantMessage(word)));
	}

	/// A step that answers in exactly these chunks, as a model may cut its answer anywhere.
	static Step chunks(String... chunks) {
		return () -> Flux.fromArray(chunks).map(chunk -> response(new AssistantMessage(chunk)));
	}

	/// A step that streams `word` every few milliseconds and never finishes, and counts `cancelled` down when the
	/// chat cancels the model call.
	static Step untilCancelled(String word, CountDownLatch cancelled) {
		return () -> Flux.interval(Duration.ofMillis(20))
				.map(_ -> response(new AssistantMessage(word)))
				.doOnCancel(cancelled::countDown);
	}

	/// A step whose model call fails with `failure`, as the client does on an HTTP error or a timeout.
	static Step failure(RuntimeException failure) {
		return () -> Flux.error(failure);
	}

	/// Runs `action` when the model is called, then answers as `step`: something that happens mid-stream.
	static Step after(Runnable action, Step step) {
		return () -> Flux.defer(() -> {
			action.run();
			return step.respond();
		});
	}

	/// Every prompt the model was sent since the script was set, oldest first.
	List<Prompt> prompts() {
		return List.copyOf(prompts);
	}

	@Override
	public ChatOptions getOptions() {
		return ToolCallingChatOptions.builder().build();
	}

	@Override
	public ChatResponse call(Prompt prompt) {
		throw new UnsupportedOperationException("The chat streams its answers");
	}

	@Override
	public Flux<ChatResponse> stream(Prompt prompt) {
		return Flux.deferContextual(reactorContext -> {
			prompts.add(prompt);
			var step = script.poll();
			if (step == null) {
				return Flux.error(new IllegalStateException("The script has no step left for model call "
						+ prompts.size()));
			}
			var context = ChatModelObservationContext.builder().prompt(prompt).provider("scripted").streaming(true)
					.build();
			var observation = ChatModelObservationDocumentation.CHAT_MODEL_OPERATION.observation(null, CONVENTION,
					() -> context, observations);
			Observation parent = reactorContext.getOrDefault(ObservationThreadLocalAccessor.KEY, null);
			observation.parentObservation(parent);
			try (var _ = parent == null ? Observation.Scope.NOOP : parent.openScope()) {
				observation.start();
			}
			var responses = step.respond()
					.doOnError(observation::error)
					.doFinally(signal -> observation.stop())
					.contextWrite(ctx -> ctx.put(ObservationThreadLocalAccessor.KEY, observation));
			return new MessageAggregator().aggregate(responses, context::setResponse);
		});
	}

	private static ChatResponse response(AssistantMessage message) {
		return new ChatResponse(List.of(new Generation(message)));
	}

}
