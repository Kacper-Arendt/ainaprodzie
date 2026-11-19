package app.retrofit.chat;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.jspecify.annotations.Nullable;
import org.springframework.ai.chat.observation.ChatModelObservationContext;

import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationHandler;
import io.micrometer.tracing.TraceContext;
import io.micrometer.tracing.handler.TracingObservationHandler.TracingContext;

/// The model calls under way, so the call to LiteLLM can name its own model span as its parent (chat ADR 0014).
///
/// The OpenAI client builds its request before Spring AI starts the model observation, and makes the call on threads
/// of its own, so neither the request nor the calling thread knows the model span. A question's model calls run one
/// after another, so a trace has at most one model call open, and the trace id the request already carries finds it.
final class OpenModelCalls implements ObservationHandler<ChatModelObservationContext> {

	private final Set<ChatModelObservationContext> open = ConcurrentHashMap.newKeySet();

	@Override
	public boolean supportsContext(Observation.Context context) {
		return context instanceof ChatModelObservationContext;
	}

	@Override
	public void onStart(ChatModelObservationContext context) {
		open.add(context);
	}

	@Override
	public void onStop(ChatModelObservationContext context) {
		open.remove(context);
	}

	/// The span of the model call open in the trace, if one is.
	@Nullable TraceContext in(String traceId) {
		for (var context : open) {
			TracingContext tracing = context.get(TracingContext.class);
			var span = tracing == null ? null : tracing.getSpan();
			if (span != null && span.context().traceId().equals(traceId)) {
				return span.context();
			}
		}
		return null;
	}

}
