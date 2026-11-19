package app.retrofit.chat;

import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;

import org.jspecify.annotations.Nullable;

/// A failure as the chat logs it: the class and the stack trace of each cause, never a message. A message can quote
/// the user's words: a binding failure quotes the model's arguments, and LiteLLM's error body can echo the request
/// (R14 of the chat's spec).
final class RedactedFailure extends RuntimeException {

	private RedactedFailure(Throwable original, @Nullable RedactedFailure cause) {
		super(original.getClass().getName() + " (message withheld)", cause, false, true);
		setStackTrace(original.getStackTrace());
	}

	static RedactedFailure of(Throwable failure) {
		var chain = new ArrayList<Throwable>();
		var seen = Collections.newSetFromMap(new IdentityHashMap<Throwable, Boolean>());
		for (@Nullable Throwable cause = failure; cause != null && seen.add(cause); cause = cause.getCause()) {
			chain.add(cause);
		}
		var redacted = new RedactedFailure(chain.getLast(), null);
		for (var cause : chain.reversed().subList(1, chain.size())) {
			redacted = new RedactedFailure(cause, redacted);
		}
		return redacted;
	}

}
