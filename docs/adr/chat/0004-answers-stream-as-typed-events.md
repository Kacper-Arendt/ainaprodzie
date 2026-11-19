# The chat streams its answer as typed events

A question goes to `POST /api/chat/conversations/{conversationId}/messages`, and the answer comes back as a `text/event-stream` of typed events: `token` for each piece of the answer text, then `done`, or `error` with a code. The events are one sealed `ChatEvent` type in Java and one `oneOf` schema with a discriminator in the OpenAPI contract, so the SPA's types still come from the contract. The SPA reads the stream with `fetch` and a `ReadableStream`, because `EventSource` can only send GET and cannot carry the CSRF header.

The reason is the user's wait. A model writes its answer piece by piece, and an answer that streams in starts to read at once, where a complete one leaves the user looking at a spinner for several seconds. The answer streaming in is also what makes the chat look different from a search box in the first minute of the demo. The events are typed because the stream has to say more than text: that the answer is complete, or that it failed after the stream started.

## Considered Options

- **One JSON response when the answer is complete.** This was rejected because the user looks at a spinner until the whole answer is written.
- **WebSocket.** This was rejected because the conversation is one request and one streamed answer. Nothing flows from the browser while the answer streams except a cancel, which closing the request already expresses.

## Consequences

- A failure before the stream starts (validation, authentication) is an ordinary `ProblemDetail` with its status. Once the stream has started the status is already 200, so a later failure is an `error` event whose code (`rate-limited`, `unavailable`, `timeout`, `personal-data-blocked`, `failed`) the SPA turns into a translated message.
- `spring.ai.openai.timeout` bounds one model call. The whole turn has one deadline too, `retrofit.chat.turn-timeout`, applied to the stream in `ChatService` and shared by every element, so a steadily streaming model cannot outrun it. Past it the turn ends with the `timeout` code.
- An `EventSource` can no longer be the client. The stream needs the CSRF header but not the rest of `api()`, which builds the headers and calls `fetch` in one function. A refactor of the SPA's API module extracts the header building into an exported function that `api()` and the stream both call, so the stream does not read the cookie a second time.
- Streaming went through LiteLLM's OpenAI emulation of Gemini in a check against a mocked provider.
