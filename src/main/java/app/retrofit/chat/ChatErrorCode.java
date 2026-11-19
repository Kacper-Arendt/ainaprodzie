package app.retrofit.chat;

import com.fasterxml.jackson.annotation.JsonValue;

/// The code of an `error` event: why an answer ended early. [ChatErrors] chooses it.
enum ChatErrorCode {

	/// LiteLLM answered 429: the provider's quota is spent for now.
	RATE_LIMITED("rate-limited"),

	/// LiteLLM cannot be reached, or it or the provider failed with a 5xx.
	UNAVAILABLE("unavailable"),

	/// The model did not answer within the client's timeout.
	TIMEOUT("timeout"),

	/// LiteLLM's guardrail refused the request for personal data it may not send, a card number (chat ADR 0017).
	PERSONAL_DATA_BLOCKED("personal-data-blocked"),

	/// Anything else: an empty answer, an unexpected exception.
	FAILED("failed");

	private final String code;

	ChatErrorCode(String code) {
		this.code = code;
	}

	/// The code as the SPA reads it, and as the contract lists it. Public, because springdoc derives the contract's
	/// values only from a public `@JsonValue` method.
	@JsonValue
	public String code() {
		return code;
	}

}
