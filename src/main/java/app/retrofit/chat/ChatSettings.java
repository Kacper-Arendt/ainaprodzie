package app.retrofit.chat;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;

/// `gatewayTracesJoined` sends the question's `traceparent` to LiteLLM while the app exports no spans, so LiteLLM's
/// calls of one question share a trace whose app spans never arrive (chat ADR 0015). `appLlmSpansExported` sends the
/// app's span of a model call as an LLM span with the call's tokens and model, beside LiteLLM's, so a joined trace
/// counts the call twice; off, it is a plain step and only LiteLLM's span counts the call (chat ADR 0016). `model` is the LiteLLM alias every question goes to, one of `retrofit.chat.models`.
record ChatSettings(@Schema(requiredMode = REQUIRED) boolean appTracesExported,
		@Schema(requiredMode = REQUIRED) boolean gatewayTracesJoined,
		@Schema(requiredMode = REQUIRED) boolean appLlmSpansExported,
		@Schema(requiredMode = REQUIRED) String model) {

	/// Whether the model calls carry the question's `traceparent`.
	boolean traceparentSent() {
		return appTracesExported || gatewayTracesJoined;
	}

}
