# LiteLLM traces every model call, and the app joins its spans to them while support staff allow it

The chat is traced twice. LiteLLM reports every model call to Phoenix through the callback of chat ADR 0014 (`litellm/phoenix_callback.py`, LiteLLM's `arize_phoenix` pricing each call once), so a call is priced from the provider's own model name whatever the app does. The app adds its own spans (the HTTP request, the chat client and the model calls) only while a switch that support staff set on the Settings page says so, and then the two are one trace. This answers part of chat ADR 0007, which rejected tracing in LiteLLM because it cannot see the question around the model calls: LiteLLM alone is now the default, and the question's own spans are one switch away.

Both sides write to one Phoenix project, `retrofit`: the app through the resource attribute `openinference.project.name` in `application.yml`, LiteLLM through `PHOENIX_PROJECT_NAME` in `compose.yaml`. This supersedes the project of its own that chat ADR 0014 gave LiteLLM. That ADR rejected one project because a model call traced by both sides would be priced twice in it; the app's model span is no longer priced (`retrofit.chat.tracing.model-names` is gone, L1), and a question's trace and its model calls can only be one trace inside one project.

## The switch

- **Stored.** One row in `chat_setting` (`app_traces_exported`, off in the changeset, a `CHECK` keeps it to one row), read through `GET /api/chat/settings` and changed through `PATCH`, a merge patch that names only the settings it changes; the others stay as stored, and the answer is every stored setting. A `PUT` of every setting was rejected: the Settings page sent its loaded copy, so a change of one setting undid what someone else had changed in another since the page loaded. Two changes of the same setting end as the later one; the settings carry no version. Only support staff may call it (`SecurityConfig` matcher, 403 `auth/forbidden` for a customer). A fresh database exports no app spans until support staff turn the switch on. An in-memory switch was rejected: it would forget the choice at each restart and differ between instances.
- **Global.** One value for the whole app, not audited, not per person.
- **Gate before export.** `SwitchedSpanExporter` wraps the exporters. It reads the switch once per export batch, at export time, so spans batched before a change leave or drop by the state that holds when they are exported. Off drops the batch as a success. A switch that cannot be read counts as off. The store is looked up lazily, so the tracer provider does not bring the datasource up early. Gating the sampler was rejected: it decides when a span starts, so a change would not reach spans already batched, and a dropped span would break the trace's parent links instead of leaving them whole.
- **No `traceparent` while off, unless joined.** `ChatService` writes the header only while the switch is on, so LiteLLM's spans are roots then and show in Phoenix's trace list (below). A second switch, `gateway_traces_joined` ("Group LiteLLM calls per chat message" on the Settings page, off in its changeset), sends it while app traces are off too: LiteLLM's calls for one chat message then share that message's trace, whose app spans never arrive, so Phoenix lists each call as a row of its own, as its parent is missing (L9). With app traces on it changes nothing.
- **Settings traffic is not traced.** `onlyChatRequests` narrows from `/api/chat/` to `/api/chat/conversations/`, so loading or saving the Settings page never appears as a trace.

## The join

The `traceparent` header is written once per question, on the request thread, by Spring Boot's Micrometer `Propagator` from the question's HTTP request span, and rides on every model call of the question as a per-request custom header. An OkHttp interceptor on the OpenAI client (`OpenAiHttpClientBuilderCustomizer`) then rewrites it to the span of the model call that is going out, so each `litellm_proxy_request` hangs under the app's model span that made it. The header cannot carry the model span from the start: Spring AI builds the request, headers included, before it starts the model observation. Nor can the interceptor read the current span: the OpenAI client enqueues the call from `ForkJoinPool.commonPool()`, where no context is current, and Reactor's context propagation does not reach it. So `OpenModelCalls`, an observation handler, keeps the model calls under way, and the interceptor takes the one open in the trace the header names; a question's model calls run one after another, so a trace has at most one open. A request without a `traceparent` (the switch off, or no request span) stays without one. Seen with the switch on, before the rewrite: one trace, with LiteLLM's `litellm_proxy_request` spans and their `litellm_request` children under the HTTP root.

The propagator is registered only while tracing export is enabled (Spring Boot 4.1 registers the W3C propagator under `@ConditionalOnEnabledTracingExport`). With export off, as in the `test` profile, no header is written, and a test of the header turns export on.

## Seen in the live check

The check ran against the compose stack (LiteLLM v1.106.6, Phoenix 21.0.0) with `chat-gemini`; `chat-anthropic` was not run (no key), so the price of `claude-haiku-5-5` was not checked.

- **Model name and price (L1).** LiteLLM's span names the provider model (`llm.model_name = gemini-3.5-flash-lite`, `llm.provider = gemini`) and carries `llm.cost.total`, and Phoenix prices it. The app therefore sets no `llm.model_name` and `retrofit.chat.tracing.model-names` is gone. Phoenix still derives `llm.model_name = chat-gemini` on the app's model span from `gen_ai.request.model`; the alias has no price, so that span costs nothing. The streamed chunks name the alias (L11), so the app span's response model does not become a second priced name.
- **Join (L2).** LiteLLM honours an incoming `traceparent`: its `litellm_proxy_request` has the sent trace id and the sent span as its parent, with message logging off too.
- **Forwarded headers and spend logs** (checked again on v1.108.3). The request headers LiteLLM keeps in its metadata leave out `Authorization`, so the app's key reaches neither Phoenix nor the spend logs. `turn_off_message_logging` also redacted the messages in the spend logs (`redacted-by-litellm`), which is one reason content was turned back on (below).
- **Metadata and user (L3).** `prompt_name`, `prompt_version` and `conversation_id` reach LiteLLM's spans in full as `metadata.requester_metadata.*`, and Phoenix filters on them (`metadata["requester_metadata"]["conversation_id"] == "..."`), so `config.yaml` names no allowlist. The app sends the caller's id as the request's `user`, a UUID that names no one by itself, so LiteLLM counts spend per end user (`/customer/info`) and Phoenix lists the calls by user. LiteLLM copies `user` into `user.id`, `llm.user` and `session.id` alike, so `phoenix_callback.py` sets `session.id` to the conversation id and puts both on `litellm_proxy_request` too, which is the trace's root while no `traceparent` is sent; the app's own spans carry the same `user.id` and `session.id`, and a conversation is one Phoenix session either way. Checked on v1.108.3. LiteLLM also records the app's request headers as metadata (`user-agent`, `host`, the `x-stainless-*` client headers) and its key alias, budget and spend; no `Authorization` header and no key appear. The provider answered every request with metadata normally (L10).
- **Content (L4).** Content was first switched off (`turn_off_message_logging: true`), then turned back on with `store_prompts_in_spend_logs: true`, so LiteLLM's spans and its admin UI's Logs show each prompt and answer. They hold what the provider receives, personal data a user typed included, stored as written, in Phoenix and in LiteLLM's tables, with no retention limit. The provider sees the same text, so storing it adds places, not exposure to a new party.
- **Content attributes (L6).** The message attributes are present without `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`, so the variable stays unset.
- **Project (L5).** `PHOENIX_PROJECT_NAME: retrofit` alone puts LiteLLM's spans in project `retrofit`; no `LITELLM_OTEL_V2` is needed.
- **Orphans (L9).** A span sent without `traceparent` is its own trace and is listed by Phoenix's root-span filter (`parent_id is None`). A span whose parent never arrives is different: with the switch flipped Off before the app's spans were exported, a full queue, a failed OTLP export or the shutdown flush, LiteLLM's span keeps the app's span as its parent, and that parent is absent. Phoenix lists such a trace (`GET /v1/projects/retrofit/traces`, counted in the project's trace count) but not among the root spans, and the trace has no root.

## Seen end to end

On a fresh compose database, as support staff:

- `GET /api/chat/settings` answered `{"appTracesExported":false}`; a customer got 403.
- **Off.** Project `retrofit` held one trace per model call and no app span. Each `litellm_proxy_request` was a root, carried the provider model, a cost and the metadata keys, and no content (it was off then).
- **On.** The switch was flipped on the Settings page. The question was one trace: the HTTP root with the chat client and model spans, and LiteLLM's spans under it, with the same metadata and still no content (it was off then). The app's model spans carried no cost.
- **Cost and tokens.** LiteLLM emits two priced LLM spans per call, `litellm_proxy_request` and its child `litellm_request`, each with the call's full cost and tokens. Phoenix prices both, so every trace shows twice the cost of its calls (0.0014734 for a call that cost 0.0007367), joined or not. This was seen with the plain `arize_phoenix` callback; the callback of chat ADR 0014 leaves `litellm_proxy_request` a chain, so only `litellm_request` is priced. With the switch on, the app's model span still counts the call's tokens beside `litellm_request`, so a joined trace shows twice the tokens and the cost once.
- The header holds the Settings link, "Czat", "Wyloguj się" and the whole wordmark at 360px and 390px in both languages (the bar wraps; chat ADR 0001 lists the seam).

## Considered Options

- **A separate `litellm` Phoenix project** (chat ADR 0014). Superseded: see above.
- **Gating the sampler.** Rejected: see above.
- **An in-memory switch.** Rejected: see above.
- **A `PUT` of every setting.** Rejected: see above.
- **`traceparent` from the current span in the interceptor**, with the OkHttp dispatcher wrapped to restore the enqueuing thread's context and Reactor's context propagation on. Rejected: tried, and the OpenAI client enqueues from `ForkJoinPool.commonPool()`, where the model span is not current.
- **The caller's id as metadata only, with no `user`.** Rejected: Phoenix's users and LiteLLM's spend per end user stay empty, and the callback can correct the session `user` brings with it (L3).
- **A metadata allowlist.** Not needed: the callback exports the keys unfiltered (L3). A comment in `config.yaml` says why none is named.

## Consequences

- With the default off, a fresh database sends no app spans; the README and the course agenda tell the instructor to turn the switch on to see the app's spans.
- A trace joined to the app's spans holds two counts of the same tokens and one of the cost (above), unless "App LLM traces to Phoenix" is off (chat ADR 0016).
- LiteLLM's spans and spend logs carry the prompts and answers as written, and so do the app's own spans while the switch is on (chat ADR 0007).
- LiteLLM's spans also hold the request headers the app sends and the app key's alias and spend. Nothing secret is among them today; a new header with a secret would reach Phoenix.
- A trace whose app spans were dropped after the header was sent has no root and does not show among root spans.
- After a forward merge into a branch that adds LiteLLM calls the chat does not make, such as embeddings, those calls also reach project `retrofit`, and the merge decides whether they stay. The Settings link moves into the navigation that branch builds.
- Phoenix's built-in prices may lack `claude-haiku-5-5`, so the `chat-anthropic` path may stay unpriced; not checked.
