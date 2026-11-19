# The app's model span is an LLM span only while a switch says so

With app traces on, a question's trace holds two LLM spans per model call: Spring AI's chat-model observation (`gen_ai.client.operation`, the span `chat <alias>`) and LiteLLM's `litellm_request` under it (chat ADR 0015). Phoenix adds the tokens of every LLM span in a trace, so the trace shows each call's tokens twice. The cost is counted once only because the app's span names the alias, which Phoenix cannot price; a priced alias would double it too.

A third switch on the Settings page, "App LLM traces to Phoenix" (`app_llm_spans_exported` in `chat_setting`, on in its changeset), decides it. On keeps the double count on purpose: the course shows the problem first, then turns the switch off. The switch matters only while app traces are on, so the page disables it while they are off, as it disables the grouping switch while they are on.

While it is off, `ChatTraceContentFilter` turns the app's model span into a plain step: `openinference.span.kind = CHAIN`, and without `gen_ai.usage.*` (cache counts included) and `gen_ai.request.model` / `gen_ai.response.model`, from which Phoenix derives `llm.token_count.*` and `llm.model_name`. The texts, `session.id`, `user.id` and the prompt's version stay. Only `litellm_request` counts the call, with the provider model, the cache counts and LiteLLM's cost. The filter runs after `StreamedCacheUsage` (`@Order`), which adds the cache counts it removes. `ChatService` reads the switch once per question with the other settings and passes it in the advisor context, where the filter reads it, as it reads the caller's id.

## Seen in the live check

Against the compose stack with `chat-anthropic`, app traces on: with the switch on, the trace held `chat chat-anthropic` (LLM, 540 tokens, no cost) and `litellm_request` (LLM, `claude-haiku-5-5`, `anthropic`, 540 tokens, 0.0001084), so 1,080 tokens. Off, `chat chat-anthropic` was a `CHAIN` with no tokens and no model, and `litellm_request` the one LLM span (547 tokens, 0.0001119). In both, one trace: `litellm_proxy_request` under the app's model span, every app span (`chat_client`, `tool_calling`, `stream`) with its duration.

## Considered Options

- **Turning the chat-model observation off with an `ObservationPredicate`.** Rejected: the predicate decides before the observation knows its question, so it cannot read a per-question switch without a settings read per model call; and without the model span `OpenModelCalls` has no span to name in the `traceparent`, so LiteLLM's spans would move up under the request span.
- **A Spring AI property.** None in 2.0.2 turns off the chat-model observation alone, and a property cannot change at run time.
- **Rewriting the spans in an OpenTelemetry Collector.** Rejected: one more service for one attribute rule, and the switch would live outside the app.
- **Leaving the alias unpriced, or pricing it in Phoenix.** Rejected: the tokens still count twice, and a price makes the cost double too.

## Consequences

- Off, the app's model span keeps its texts but shows no tokens or model; they are on `litellm_request`, its grandchild.
- The switch is global and not audited, like the others (chat ADR 0015).
- A model call LiteLLM does not trace (Phoenix down, a call outside LiteLLM) has no counted tokens anywhere while the switch is off.
