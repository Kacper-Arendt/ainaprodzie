# The system prompt is a static prefix, and its version is the hash of its file

Every request sends the same system prompt, word for word. What differs per request, namely who is signed in, the current time and the language of the user interface, goes into a context block at the start of the latest user message. Memory stores the question without that block. Each call is therefore the system prompt, the earlier turns and the latest message. Everything before the latest message is shared: the system prompt by all users, the earlier turns by the later calls of the same conversation. Providers that cache a shared prefix, Gemini among them, reuse it automatically. That needs no provider-specific feature in the app, which chat ADR 0002 puts out of its reach, only a prefix that does not change.

The prompt lives in the repository as `prompts/chat-system.st`. Its version is the first 12 hex digits of the SHA-256 of that file, computed at startup and recorded on every span (chat ADR 0007) and in the metadata of every model call, which LiteLLM puts on its own spans (chat ADR 0015). A change to the prompt is a reviewed diff, and the version follows it with nobody having to remember a number.

## Considered Options

- **The user's context in the system prompt**, as a template filled per request. This was rejected because the current time changes with every request, and everything after it in the prompt could not be shared between calls.
- **A hand-numbered version.** This was rejected because a forgotten bump gives two different prompts the same version, and their traces can then not be told apart.
- **Prompts managed in the tracing backend** (Langfuse or Phoenix prompt management). This was rejected because the prompt would live outside git, and a commit would no longer pin the prompt it runs with.

## Consequences

- The context block sits in a user message, so a user can type a fake one. It changes nothing they may read: the model reads no data, and the memory key comes from the session, not from the stated role (chat ADR 0005).
- Gemini caches implicitly only above a minimum prefix length, which is undocumented for `gemini-3.5-flash-lite`. On that model nothing was read from the cache, not even for five identical requests of 3,617 tokens sent a few seconds apart, through LiteLLM or straight to the Gemini API, and the chat's prefix is far shorter. On a miss Gemini reports no cached token count at all, not zero, so the model call span carries no cache read. Measuring the hit rate is part of the production lesson.
- Anthropic does not cache implicitly: it reuses only a prefix marked with `cache_control`, which an OpenAI-shaped request cannot carry. LiteLLM adds the marker itself, which keeps it out of the app: `chat-anthropic` in `litellm/config.yaml` has one `cache_control_injection_points` entry, on the system message. Anthropic caches the prefix up to the marked block. The system prompt alone is about 250 tokens, below the 512-token minimum of Haiku 5.5 and Sonnet 5.5, below which a marker is ignored without an error, so the marker caches nothing until the prefix grows past it.
- The cache lives for the default 5 minutes, which every read renews. The 1-hour lifetime doubles the input price of a write instead of adding a quarter, and during the exercises a participant asks more often than every 5 minutes anyway. A second marker on the last message would let each question read the earlier turns of its conversation as well; it is an optimization for the production lesson to measure, not part of laying out the prompt.
