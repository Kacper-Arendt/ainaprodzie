package app.retrofit.chat;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/// The LiteLLM aliases support staff choose the chat's model from, `retrofit.chat.models`, in their configured order.
record ChatModels(@Schema(requiredMode = REQUIRED) List<String> models) {
}
