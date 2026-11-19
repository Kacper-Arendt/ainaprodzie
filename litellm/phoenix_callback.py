"""LiteLLM's arize_phoenix callback, with each model call priced once (chat ADR 0014) and its conversation as the session
(chat ADR 0015).

In the proxy, LiteLLM 1.108.8 wraps every model call in a parent span, litellm_proxy_request, and gives it every
attribute of the call's own span, the model and the tokens included. Phoenix prices both, so a trace and the project
would show twice the cost. The parent span here keeps its place in the tree but only marks itself as a chain, and the
cost stays on the call's span. config.yaml names this handler instead of arize_phoenix; once LiteLLM stops copying the
attributes (https://github.com/BerriAI/litellm/issues/50649), the callback goes back to arize_phoenix and this file
goes away.

LiteLLM puts the request's user, the app's caller, on session.id as well as user.id. Here session.id is the
conversation the app sends as conversation_id, so Phoenix groups a conversation's calls as one session. Both spans carry
the user and the session, because Phoenix reads them from a trace's root, which is litellm_proxy_request when the app
sends no traceparent.
"""

from litellm.integrations._types.open_inference import OpenInferenceSpanKindValues, SpanAttributes
from litellm.integrations.arize.arize_phoenix import ArizePhoenixLogger
from litellm.integrations.opentelemetry import OpenTelemetryConfig

PROXY_REQUEST_SPAN = "litellm_proxy_request"


class PricedOnceArizePhoenixLogger(ArizePhoenixLogger):
    def set_attributes(self, span, kwargs, response_obj):
        if span.name == PROXY_REQUEST_SPAN:
            span.set_attribute(SpanAttributes.OPENINFERENCE_SPAN_KIND, OpenInferenceSpanKindValues.CHAIN.value)
        else:
            super().set_attributes(span, kwargs, response_obj)
        _set_user_and_session(span, kwargs)


def _set_user_and_session(span, kwargs):
    payload = kwargs.get("standard_logging_object") or {}
    user = (payload.get("model_parameters") or {}).get("user")
    if user:
        span.set_attribute(SpanAttributes.USER_ID, str(user))
    conversation = ((payload.get("metadata") or {}).get("requester_metadata") or {}).get("conversation_id")
    if conversation:
        span.set_attribute(SpanAttributes.SESSION_ID, str(conversation))


# Built as LiteLLM builds arize_phoenix, from PHOENIX_COLLECTOR_HTTP_ENDPOINT and the rest of its environment.
_config = ArizePhoenixLogger.get_arize_phoenix_config()
handler = PricedOnceArizePhoenixLogger(
    config=OpenTelemetryConfig(
        exporter=_config.protocol, endpoint=_config.endpoint, headers=_config.otlp_auth_headers
    ),
    callback_name="arize_phoenix",
)
