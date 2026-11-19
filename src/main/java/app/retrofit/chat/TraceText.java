package app.retrofit.chat;

import io.opentelemetry.api.common.AttributeKey;

/// The span attributes that carry the chat's texts, under the GenAI semantic convention names (chat ADR 0007).
/// [ChatTraceContentFilter] writes a prompt or an answer only under one of these.
enum TraceText {

	INPUT_MESSAGES("gen_ai.input.messages"),

	OUTPUT_MESSAGES("gen_ai.output.messages");

	private final AttributeKey<String> key;

	TraceText(String name) {
		this.key = AttributeKey.stringKey(name);
	}

	AttributeKey<String> key() {
		return key;
	}

}
