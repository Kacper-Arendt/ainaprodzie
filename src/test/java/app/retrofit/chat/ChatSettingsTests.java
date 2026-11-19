package app.retrofit.chat;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;

import app.retrofit.RandomPortContext;
import app.retrofit.TestUsers;
import app.retrofit.auth.Role;

/// `/api/chat/settings` and `/api/chat/models`: support only, the stored global settings of the chat, its traces'
/// switches and its model.
class ChatSettingsTests extends RandomPortContext {

	private static final String PROBLEMS = "https://retrofit.app/problems/";

	private static final ParameterizedTypeReference<Map<String, Object>> JSON_OBJECT = new ParameterizedTypeReference<>() {
	};

	@Autowired
	PasswordEncoder passwordEncoder;

	@Autowired
	ChatSettingStore store;

	TestUsers users;

	@BeforeEach
	void setUp() {
		users = new TestUsers(jdbc, passwordEncoder);
		store.change(new ChatSettingsChange(false, false, true, "chat-gemini"));
	}

	@Test
	void supportReadsAndChangesTheSwitches() {
		var support = users.create(Role.SUPPORT);
		var session = login(support.email(), support.password());

		assertThat(get(session).getBody()).isEqualTo(settings(false, false, "chat-gemini"));

		var enabled = patch(session, Map.of("appTracesExported", true));
		assertThat(enabled.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(enabled.getBody()).isEqualTo(settings(true, false, "chat-gemini"));
		assertThat(store.settings()).isEqualTo(new ChatSettings(true, false, true, "chat-gemini"));

		var joined = patch(session, Map.of("appTracesExported", false, "gatewayTracesJoined", true));
		assertThat(joined.getBody()).isEqualTo(settings(false, true, "chat-gemini"));
		assertThat(get(session).getBody()).isEqualTo(settings(false, true, "chat-gemini"));

		var llmSpansOff = patch(session, Map.of("appLlmSpansExported", false));
		assertThat(llmSpansOff.getBody()).isEqualTo(settings(false, true, false, "chat-gemini"));
		assertThat(store.settings()).isEqualTo(new ChatSettings(false, true, false, "chat-gemini"));
	}

	@Test
	void aChangeOfOneSettingKeepsWhatAnotherChangeStored() {
		var support = users.create(Role.SUPPORT);
		var session = login(support.email(), support.password());

		patch(session, Map.of("appTracesExported", true));
		var changed = patch(session, Map.of("model", "chat-anthropic"));

		assertThat(changed.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(changed.getBody()).isEqualTo(settings(true, false, "chat-anthropic"));
		assertThat(get(session).getBody()).isEqualTo(settings(true, false, "chat-anthropic"));
	}

	@Test
	void supportChoosesTheModelFromTheConfiguredAliases() {
		var support = users.create(Role.SUPPORT);
		var session = login(support.email(), support.password());

		var models = http().get().uri("/api/chat/models")
				.header(HttpHeaders.COOKIE, "SESSION=" + session)
				.retrieve()
				.toEntity(JSON_OBJECT);
		assertThat(models.getBody()).isEqualTo(Map.of("models", List.of("chat-gemini", "chat-anthropic", "chat-chaos")));

		var changed = patch(session, Map.of("model", "chat-anthropic"));
		assertThat(changed.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(store.settings()).isEqualTo(new ChatSettings(false, false, true, "chat-anthropic"));
	}

	@Test
	@SuppressWarnings("unchecked")
	void aModelOutsideTheConfiguredAliasesIsUnknown() {
		var support = users.create(Role.SUPPORT);
		var session = login(support.email(), support.password());

		var response = patch(session, Map.of("model", "gpt-4o"));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
		var errors = (List<Map<String, Object>>) response.getBody().get("errors");
		assertThat(errors).singleElement().satisfies(error -> {
			assertThat(error).containsEntry("field", "model");
			assertThat(error).containsEntry("code", "model.unknown");
		});
		assertThat(store.settings()).isEqualTo(new ChatSettings(false, false, true, "chat-gemini"));
	}

	@Test
	void customerCannotReadTheModels() {
		var customer = users.create(Role.USER);
		var session = login(customer.email(), customer.password());

		var response = http().get().uri("/api/chat/models")
				.header(HttpHeaders.COOKIE, "SESSION=" + session)
				.retrieve()
				.toEntity(JSON_OBJECT);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
	}

	@Test
	void customerCannotReadTheSwitch() {
		var customer = users.create(Role.USER);
		var session = login(customer.email(), customer.password());

		var response = get(session);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "auth/forbidden");
	}

	@Test
	void customerCannotChangeTheSwitch() {
		var customer = users.create(Role.USER);
		var session = login(customer.email(), customer.password());

		var response = patch(session, Map.of("appTracesExported", true));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "auth/forbidden");
		assertThat(store.settings()).isEqualTo(new ChatSettings(false, false, true, "chat-gemini"));
	}

	@Test
	void aSettingLeftOutOrNullStaysAsStored() {
		var support = users.create(Role.SUPPORT);
		var session = login(support.email(), support.password());
		store.change(new ChatSettingsChange(true, true, false, "chat-anthropic"));
		var nullSettings = new HashMap<String, Object>();
		nullSettings.put("appTracesExported", null);
		nullSettings.put("gatewayTracesJoined", null);
		nullSettings.put("appLlmSpansExported", null);
		nullSettings.put("model", null);

		for (var body : List.<Map<String, Object>>of(Map.of(), nullSettings)) {
			var response = patch(session, body);

			assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
			assertThat(response.getBody()).isEqualTo(settings(true, true, false, "chat-anthropic"));
		}
	}

	@Test
	@SuppressWarnings("unchecked")
	void aBlankModelIsRequired() {
		var support = users.create(Role.SUPPORT);
		var session = login(support.email(), support.password());

		var response = patch(session, Map.of("model", " "));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
		var errors = (List<Map<String, Object>>) response.getBody().get("errors");
		assertThat(errors).singleElement().satisfies(error -> {
			assertThat(error).containsEntry("field", "model");
			assertThat(error).containsEntry("code", "field.required");
		});
		assertThat(store.settings()).isEqualTo(new ChatSettings(false, false, true, "chat-gemini"));
	}

	@Test
	void aSwitchThatIsNotABooleanIsAMalformedRequest() {
		var support = users.create(Role.SUPPORT);
		var session = login(support.email(), support.password());

		var response = patch(session, Map.of("appTracesExported", "maybe"));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody()).containsEntry("type", PROBLEMS + "malformed-request");
		assertThat(store.settings()).isEqualTo(new ChatSettings(false, false, true, "chat-gemini"));
	}

	@Test
	void aChangeWithoutTheCsrfTokenIsForbiddenAndLeavesTheSwitch() {
		var support = users.create(Role.SUPPORT);
		var session = login(support.email(), support.password());

		var response = http().patch().uri("/api/chat/settings")
				.header(HttpHeaders.COOKIE, "SESSION=" + session)
				.contentType(MediaType.APPLICATION_JSON)
				.body(Map.of("appTracesExported", true))
				.retrieve()
				.toEntity(JSON_OBJECT);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
		assertThat(store.settings()).isEqualTo(new ChatSettings(false, false, true, "chat-gemini"));
	}

	@Test
	void settingsHoldExactlyOneRow() {
		store.change(new ChatSettingsChange(true, false, true, "chat-gemini"));

		var rows = jdbc.sql("SELECT count(*) FROM chat_setting").query(Long.class).single();

		assertThat(rows).isEqualTo(1L);
	}

	private static Map<String, Object> settings(boolean exported, boolean joined, String model) {
		return settings(exported, joined, true, model);
	}

	private static Map<String, Object> settings(boolean exported, boolean joined, boolean llmSpans, String model) {
		return Map.of("appTracesExported", exported, "gatewayTracesJoined", joined, "appLlmSpansExported", llmSpans,
				"model", model);
	}

	private ResponseEntity<Map<String, Object>> get(String session) {
		return http().get().uri("/api/chat/settings")
				.header(HttpHeaders.COOKIE, "SESSION=" + session)
				.retrieve()
				.toEntity(JSON_OBJECT);
	}

	private ResponseEntity<Map<String, Object>> patch(String session, Map<String, Object> body) {
		var csrf = primeCsrf();
		return http().patch().uri("/api/chat/settings")
				.header("X-XSRF-TOKEN", csrf.header())
				.header(HttpHeaders.COOKIE, csrf.cookie() + "; SESSION=" + session)
				.contentType(MediaType.APPLICATION_JSON)
				.body(body)
				.retrieve()
				.toEntity(JSON_OBJECT);
	}

}
