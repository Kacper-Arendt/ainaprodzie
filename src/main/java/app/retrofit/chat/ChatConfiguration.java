package app.retrofit.chat;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.memory.InMemoryChatMemoryRepository;
import org.springframework.ai.chat.memory.MessageWindowChatMemory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.scheduling.annotation.EnableScheduling;

/// The chat's one `ChatClient`, built from the builder Spring AI configures for the model in `application.yml`, with
/// the system prompt and no tools; and its memory.
///
/// Scheduling is enabled here, by the feature that needs it: [ChatService] forgets idle conversations on a schedule
/// (chat ADR 0005).
@Configuration(proxyBeanMethods = false)
@EnableScheduling
class ChatConfiguration {

	/// The messages a conversation remembers, its latest ten questions and answers (chat ADR 0005).
	static final int MEMORY_WINDOW = 20;

	@Bean
	SystemPrompt systemPrompt(@Value("classpath:prompts/chat-system.st") Resource resource) {
		return SystemPrompt.read("chat-system", resource);
	}

	@Bean
	ChatClient chatClient(ChatClient.Builder builder, SystemPrompt systemPrompt) {
		return builder.defaultSystem(systemPrompt.text()).build();
	}

	@Bean
	ChatMemory chatMemory() {
		return MessageWindowChatMemory.builder()
				.chatMemoryRepository(new InMemoryChatMemoryRepository())
				.maxMessages(MEMORY_WINDOW)
				.build();
	}

}
