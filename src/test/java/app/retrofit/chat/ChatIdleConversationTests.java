package app.retrofit.chat;

import static app.retrofit.chat.ScriptedChatModel.after;
import static app.retrofit.chat.ScriptedChatModel.answer;
import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.config.ScheduledTaskHolder;

import app.retrofit.auth.Role;

/// A conversation nobody asks in for `retrofit.chat.conversation-idle-timeout` is forgotten (chat ADR 0005). The suites sweep by hand: the scheduled sweep never finds a conversation
/// that idle while they run.
class ChatIdleConversationTests extends ChatServerContext {

	@Autowired
	ChatService chat;

	@Autowired
	ScheduledTaskHolder scheduling;

	@Value("${retrofit.chat.conversation-idle-timeout}")
	Duration idleTimeout;

	@Test
	void theSweepRunsOnASchedule() {
		assertThat(scheduling.getScheduledTasks()).extracting(task -> task.getTask().getRunnable().toString())
				.contains(ChatService.class.getName() + ".forgetIdleConversations");
	}

	@Test
	void aConversationIdlePastTheTimeoutIsForgotten() {
		var session = login(users.create(Role.USER));
		var conversation = UUID.randomUUID();
		model.script(answer("Hello!"));
		ask(session, conversation, "Hi, I am Anna.");

		chat.forgetIdle(Instant.now().plus(idleTimeout));
		model.script(answer("I do not know."));
		ask(session, conversation, "What is my name?");

		assertThat(model.prompts().getFirst().getContents()).doesNotContain("Hi, I am Anna.", "Hello!");
	}

	@Test
	void aConversationAskedInWithinTheTimeoutKeepsItsMemory() {
		var session = login(users.create(Role.USER));
		var conversation = UUID.randomUUID();
		var asked = Instant.now();
		model.script(answer("First answer."));
		ask(session, conversation, "First question");

		chat.forgetIdle(asked.plus(idleTimeout).minusSeconds(1));
		model.script(answer("Second answer."));
		ask(session, conversation, "Second question");

		assertThat(model.prompts().getFirst().getContents()).contains("First question", "First answer.");
	}

	/// A forgotten conversation stays forgotten: the turn that was streaming does not bring it back.
	@Test
	void aTurnStreamingWhenItsConversationIsForgottenReachesTheUserButIsNotRemembered() {
		var session = login(users.create(Role.USER));
		var conversation = UUID.randomUUID();
		model.script(answer("First answer."));
		ask(session, conversation, "First question");
		model.script(after(() -> chat.forgetIdle(Instant.now().plus(idleTimeout)), answer("Second answer.")));

		var reply = ask(session, conversation, "Second question");
		model.script(answer("Third answer."));
		ask(session, conversation, "Third question");

		assertThat(reply.text()).isEqualTo("Second answer.");
		assertThat(model.prompts().getFirst().getContents())
				.doesNotContain("First question", "Second question", "Second answer.");
	}

}
