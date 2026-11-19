package app.retrofit.chat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;

import app.retrofit.RandomPortContext;
import app.retrofit.TestUsers;
import app.retrofit.TestUsers.TestUser;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/// The chat's server suites: the real server with the [ScriptedChatModel] choosing what a model would, and helpers
/// that ask questions and read the streamed answer as the SPA does. It adds no annotation to [RandomPortContext], so
/// the suites share its application context.
abstract class ChatServerContext extends RandomPortContext {

	static final JsonMapper JSON = JsonMapper.builder().build();

	/// The display name of every user [app.retrofit.TestUsers] creates.
	static final String TEST_USER = "Test User";

	@Autowired
	ScriptedChatModel model;

	@Autowired
	PasswordEncoder passwordEncoder;

	TestUsers users;

	@BeforeEach
	void setUpUsers() {
		users = new TestUsers(jdbc, passwordEncoder);
	}

	String login(TestUser user) {
		return login(user.email(), user.password());
	}

	/// Asks `text` in a new conversation.
	Reply ask(String session, String text) {
		return ask(session, UUID.randomUUID(), text);
	}

	Reply ask(String session, UUID conversationId, String text) {
		return ask(session, conversationId, Map.of("text", text));
	}

	private Reply ask(String session, UUID conversationId, Map<String, String> body) {
		var csrf = primeCsrf();
		var response = http().post().uri("/api/chat/conversations/{conversationId}/messages", conversationId)
				.header("X-XSRF-TOKEN", csrf.header())
				.header(HttpHeaders.COOKIE, csrf.cookie() + "; SESSION=" + session)
				.header(HttpHeaders.ACCEPT_LANGUAGE, "pl")
				.contentType(MediaType.APPLICATION_JSON)
				.body(body)
				.retrieve()
				.toEntity(String.class);
		var contentType = response.getHeaders().getContentType();
		return new Reply(response.getStatusCode(), contentType, response.getBody() == null ? "" : response.getBody());
	}

	HttpStatusCode forget(String session, UUID conversationId) {
		var csrf = primeCsrf();
		return http().delete().uri("/api/chat/conversations/{conversationId}", conversationId)
				.header("X-XSRF-TOKEN", csrf.header())
				.header(HttpHeaders.COOKIE, csrf.cookie() + "; SESSION=" + session)
				.retrieve()
				.toBodilessEntity()
				.getStatusCode();
	}

	/// One streamed event as the SPA reads it: the SSE event name and its JSON data.
	record Event(String name, JsonNode data) {
	}

	/// A whole response to a question: its status and, for a stream, its body.
	record Reply(HttpStatusCode status, MediaType contentType, String body) {

		List<Event> events() {
			var events = new ArrayList<Event>();
			for (var frame : body.split("\n\n")) {
				String name = null;
				var data = new StringBuilder();
				for (var line : frame.split("\n")) {
					if (line.startsWith("event:")) {
						name = line.substring("event:".length());
					}
					else if (line.startsWith("data:")) {
						data.append(line.substring("data:".length()));
					}
				}
				if (name != null) {
					events.add(new Event(name, JSON.readTree(data.toString())));
				}
			}
			return events;
		}

		/// The events named `name`, in the order they streamed.
		List<Event> events(String name) {
			return events().stream().filter(event -> event.name().equals(name)).toList();
		}

		List<String> names() {
			return events().stream().map(Event::name).toList();
		}

		/// The answer text, as the SPA joins the `token` events.
		String text() {
			return String.join("", events().stream()
					.filter(event -> event.name().equals("token"))
					.map(event -> event.data().get("text").asString())
					.toList());
		}

		/// A response that is not a stream: its problem body.
		JsonNode problem() {
			return JSON.readTree(body);
		}

	}

}
