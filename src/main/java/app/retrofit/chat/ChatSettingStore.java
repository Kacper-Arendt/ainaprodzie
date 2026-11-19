package app.retrofit.chat;

import java.sql.Timestamp;
import java.sql.Types;
import java.time.Clock;

import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/// The chat settings: one row, created by the changeset.
@Repository
class ChatSettingStore {

	private static final RowMapper<ChatSettings> STORED = (row, number) -> new ChatSettings(
			row.getBoolean("app_traces_exported"), row.getBoolean("gateway_traces_joined"),
			row.getBoolean("app_llm_spans_exported"), row.getString("model"));

	private final JdbcClient jdbc;

	private final Clock clock;

	ChatSettingStore(JdbcClient jdbc, Clock clock) {
		this.jdbc = jdbc;
		this.clock = clock;
	}

	ChatSettings settings() {
		return jdbc.sql("SELECT app_traces_exported, gateway_traces_joined, app_llm_spans_exported, model FROM chat_setting")
				.query(STORED)
				.single();
	}

	/// Writes the settings the change names, leaves the others as stored and answers what is stored then.
	ChatSettings change(ChatSettingsChange change) {
		return jdbc.sql("""
				UPDATE chat_setting
				SET app_traces_exported = COALESCE(:exported, app_traces_exported),
				    gateway_traces_joined = COALESCE(:joined, gateway_traces_joined),
				    app_llm_spans_exported = COALESCE(:llmSpans, app_llm_spans_exported),
				    model = COALESCE(:model, model), updated_at = :now
				RETURNING app_traces_exported, gateway_traces_joined, app_llm_spans_exported, model""")
				.param("exported", change.appTracesExported(), Types.BOOLEAN)
				.param("joined", change.gatewayTracesJoined(), Types.BOOLEAN)
				.param("llmSpans", change.appLlmSpansExported(), Types.BOOLEAN)
				.param("model", change.model(), Types.VARCHAR)
				.param("now", Timestamp.from(clock.instant()))
				.query(STORED)
				.single();
	}

}
