package app.retrofit.chat;

import java.util.Collection;
import java.util.function.Supplier;

import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.opentelemetry.sdk.common.CompletableResultCode;
import io.opentelemetry.sdk.trace.data.SpanData;
import io.opentelemetry.sdk.trace.export.SpanExporter;

/// Lets a batch of the app's spans leave only while the stored switch exports the app's traces. The settings are read
/// once per batch, at export time, so spans batched before a change leave or drop by the state that holds when they are
/// exported. Off drops the batch as a success; settings that cannot be read count as off.
final class SwitchedSpanExporter implements SpanExporter {

	private static final Logger log = LoggerFactory.getLogger(SwitchedSpanExporter.class);

	private final SpanExporter exporter;

	private final Supplier<ChatSettings> settings;

	SwitchedSpanExporter(SpanExporter exporter, Supplier<ChatSettings> settings) {
		this.exporter = exporter;
		this.settings = settings;
	}

	@Override
	public CompletableResultCode export(Collection<SpanData> spans) {
		var current = settings();
		if (current == null || !current.appTracesExported()) {
			return CompletableResultCode.ofSuccess();
		}
		return exporter.export(spans);
	}

	private @Nullable ChatSettings settings() {
		try {
			return settings.get();
		}
		catch (RuntimeException ex) {
			log.warn("The trace export switch could not be read; a batch of the app's spans is dropped", ex);
			return null;
		}
	}

	@Override
	public CompletableResultCode flush() {
		return exporter.flush();
	}

	@Override
	public CompletableResultCode shutdown() {
		return exporter.shutdown();
	}

}
