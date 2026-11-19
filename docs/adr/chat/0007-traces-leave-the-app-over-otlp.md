# Traces leave the app over OTLP

LiteLLM now traces every model call to the same Phoenix project, and the app's own spans leave only while support staff switch them on (chat ADR 0015). What follows describes the app's spans.

The chat is traced from its first version, so the cost, the duration and the effect of a prompt change can be seen for each answer. Spring AI's Micrometer observations go through the OpenTelemetry bridge to an OTLP endpoint. The committed `compose.yaml` runs Arize Phoenix there: one container, no account, and its UI on the same port. The app knows only the OTLP endpoint, so any backend that accepts OTLP, Langfuse among them, takes the same spans with a different URL, the way LiteLLM keeps the provider out of the app (chat ADR 0002).

Spring AI puts no prompt or answer text on spans. Its own `log-prompt` and `log-completion` options write that text to the application log, so they stay off. The chat's observation filter puts the texts on its spans under the GenAI semantic convention names, with the prompt's name and version (chat ADR 0008), the conversation as `session.id` and the caller's id as `user.id`. The texts leave as written: the app masks nothing in its traces.

## Considered Options

- **Tracing only in LiteLLM** (its logging callbacks). This was rejected because LiteLLM sees the model calls but not the question around them, so one question would show up as unrelated calls. LiteLLM traces its model calls beside the app's (chat ADR 0014), in the app's own Phoenix project, and the app's spans join its calls under one trace (chat ADR 0015).
- **Langfuse as the default backend.** Its self-hosted stack needs ClickHouse, Redis and object storage next to its own PostgreSQL, too much for a participant's laptop. Langfuse Cloud sends every trace to an outside service. Both stay one endpoint away.

## Consequences

- While the app's spans are exported, the questions and answers reach Phoenix as written, with any personal data a user typed and the names the context block holds. The provider receives the same text.
- Phoenix converts OTel GenAI attributes since 15.10. Phoenix prices the provider model that LiteLLM's own span names, so the app sets no model name on its spans (chat ADR 0015).
- Regular tests run without an exporter; the chat's test configuration collects the spans in memory instead.
