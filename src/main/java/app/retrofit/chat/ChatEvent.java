package app.retrofit.chat;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import com.fasterxml.jackson.annotation.JsonProperty;

import io.swagger.v3.oas.annotations.media.DiscriminatorMapping;
import io.swagger.v3.oas.annotations.media.Schema;

/// One event of a streamed answer (chat ADR 0004): `token` for each piece of the answer, then `done`, or `error` in its
/// place. The SSE event
/// name and the `type` property are the same word.
@Schema(name = "ChatEvent", discriminatorProperty = "type",
		oneOf = { ChatEvent.Token.class, ChatEvent.Done.class, ChatEvent.Error.class },
		discriminatorMapping = { @DiscriminatorMapping(value = ChatEvent.TOKEN, schema = ChatEvent.Token.class),
				@DiscriminatorMapping(value = ChatEvent.DONE, schema = ChatEvent.Done.class),
				@DiscriminatorMapping(value = ChatEvent.ERROR, schema = ChatEvent.Error.class) })
sealed interface ChatEvent {

	String TOKEN = "token";

	String DONE = "done";

	String ERROR = "error";

	/// The discriminator, which is also the SSE event name.
	String type();

	/// The next piece of the answer text, Markdown written by the model.
	@Schema(name = "ChatTokenEvent")
	record Token(@Schema(requiredMode = REQUIRED) String text) implements ChatEvent {

		@Override
		@JsonProperty
		@Schema(requiredMode = REQUIRED, allowableValues = TOKEN)
		public String type() {
			return TOKEN;
		}

	}

	/// The answer is complete; the conversation remembers this turn.
	@Schema(name = "ChatDoneEvent")
	record Done() implements ChatEvent {

		@Override
		@JsonProperty
		@Schema(requiredMode = REQUIRED, allowableValues = DONE)
		public String type() {
			return DONE;
		}

	}

	/// The answer failed after the stream started; the conversation remembers nothing of this turn.
	@Schema(name = "ChatErrorEvent")
	record Error(@Schema(requiredMode = REQUIRED) ChatErrorCode code) implements ChatEvent {

		@Override
		@JsonProperty
		@Schema(requiredMode = REQUIRED, allowableValues = ERROR)
		public String type() {
			return ERROR;
		}

	}

}
