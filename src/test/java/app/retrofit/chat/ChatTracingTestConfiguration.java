package app.retrofit.chat;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter;

/// The regular tests' tracing: the `test` profile turns the OTLP export off, and this in-memory exporter collects what
/// would leave the app instead. Being a `SpanExporter` bean, it sits behind [SwitchedSpanExporter] like the OTLP
/// exporter does.
///
/// A plain `@Configuration` found by component scanning, like [ScriptedChatModelConfiguration].
@Configuration(proxyBeanMethods = false)
@Profile("test")
class ChatTracingTestConfiguration {

	@Bean
	InMemorySpanExporter inMemorySpanExporter() {
		return InMemorySpanExporter.create();
	}

}
