package app.retrofit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.InstanceOfAssertFactories.LIST;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import tools.jackson.core.type.TypeReference;
import tools.jackson.core.util.DefaultIndenter;
import tools.jackson.core.util.DefaultPrettyPrinter;
import tools.jackson.databind.SerializationFeature;
import tools.jackson.databind.json.JsonMapper;

/// Contract export: this test IS the generator for docs/api/openapi.json (the committed OpenAPI contract, single source
/// of truth for the API). It runs in `./mvnw verify`; frontend types are generated from the committed file via
/// `pnpm -C frontend generate:api`, and the manual drift check is `git diff --exit-code`.
class OpenApiExportTests extends RandomPortContext {

	/// Surefire runs with the project basedir as working directory.
	private static final Path CONTRACT_PATH = Path.of("docs/api/openapi.json");

	private static final JsonMapper MAPPER = JsonMapper.builder()
			.enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS)
			.build();

	/// Writes the contract. The assertion is a non-vacuity floor and nothing more: the committed file is the inventory,
	/// and a Java list restating all of it would be that file maintained twice by hand.
	@Test
	void exportsTheContractToTheCommittedFile() throws IOException {
		var apiDoc = fetchApiDoc();

		// The servers entry carries the random test port: drop it so the committed contract is reproducible.
		apiDoc.remove("servers");
		Files.createDirectories(CONTRACT_PATH.getParent());
		Files.writeString(CONTRACT_PATH, MAPPER.writer().with(prettyPrinter()).writeValueAsString(apiDoc) + "\n");

		assertThat(nested(apiDoc, "paths")).as("an export that wrote nothing must not pass silently")
				.containsKeys("/api/meta", "/api/auth/login", "/api/auth/logout", "/api/auth/session",
						"/api/auth/language", "/api/tickets", "/api/tickets/{reference}", "/api/organizations",
						"/api/organizations/{id}", "/api/teams");
	}

	@Test
	void responseSchemasRequireEveryFieldTheServerAlwaysSends() {
		var schemas = nested(fetchApiDoc(), "components", "schemas");

		assertThat(nested(schemas, "SessionUser").get("required"))
				.asInstanceOf(LIST)
				.containsExactlyInAnyOrder("id", "email", "displayName", "roles", "language");
		assertThat(nested(schemas, "MetaResponse").get("required"))
				.asInstanceOf(LIST)
				.containsExactlyInAnyOrder("service", "apiVersion");
		assertThat(nested(schemas, "Organization").get("required"))
				.asInstanceOf(LIST)
				.containsExactlyInAnyOrder("id", "name", "firstResponseSlaMinutes");
		assertThat(nested(schemas, "Team").get("required"))
				.asInstanceOf(LIST)
				.containsExactlyInAnyOrder("id", "name", "description", "member", "members");
	}

	@Test
	void ticketDetailsRequireTheVersion() {
		assertThat(nested(fetchApiDoc(), "components", "schemas", "TicketDetails").get("required"))
				.asInstanceOf(LIST)
				.contains("version");
	}

	@Test
	void ticketCommentsRequireTheirId() {
		assertThat(nested(fetchApiDoc(), "components", "schemas", "TicketComment").get("required"))
				.asInstanceOf(LIST)
				.contains("id");
	}

	@Test
	void teamsRequireTheirMembers() {
		assertThat(nested(fetchApiDoc(), "components", "schemas", "Team").get("required"))
				.asInstanceOf(LIST)
				.contains("members");
	}

	@Test
	void pathsListTheTicketWriteOperations() {
		var paths = nested(fetchApiDoc(), "paths");

		assertThat(nested(paths, "/api/tickets")).containsKey("post");
		assertThat(nested(paths, "/api/tickets/{reference}/comments")).containsKey("post");
		assertThat(nested(paths, "/api/tickets/{reference}/close")).containsKey("post");
		assertThat(nested(paths, "/api/tickets/{reference}")).containsKey("patch");
		assertThat(nested(paths, "/api/tickets/{reference}/links/{linkedReference}")).containsKeys("put", "delete");
	}

	@Test
	void linkTicketRequestRequiresTheType() {
		assertThat(nested(fetchApiDoc(), "components", "schemas", "LinkTicketRequest").get("required"))
				.asInstanceOf(LIST)
				.contains("type");
	}

	/// `null` in the PATCH body clears these fields, so the contract has to let the client send it.
	@Test
	void updateTicketRequestAcceptsNullForTheClearableFields() {
		var properties = nested(fetchApiDoc(), "components", "schemas", "UpdateTicketRequest", "properties");

		for (var field : List.of("category", "teamId", "assigneeId")) {
			assertThat(nested(properties, field).get("type")).as(field).asInstanceOf(LIST).contains("null");
		}
	}

	@Test
	void nullableReferencesAreAnyOfTheReferenceAndNull() {
		var team = nested(fetchApiDoc(), "components", "schemas", "TicketSummary", "properties", "team");

		assertThat(team).containsOnlyKeys("anyOf");
		assertThat(team.get("anyOf")).asInstanceOf(LIST).containsExactly(
				Map.of("$ref", "#/components/schemas/NamedRef"), Map.of("type", "null"));
	}

	private Map<String, Object> fetchApiDoc() {
		var body = http().get().uri("/v3/api-docs").retrieve().body(String.class);
		return MAPPER.readValue(body, new TypeReference<Map<String, Object>>() {
		});
	}

	@SuppressWarnings("unchecked")
	private static Map<String, Object> nested(Map<String, Object> root, String... keys) {
		var current = root;
		for (String key : keys) {
			assertThat(current).as("object containing '%s'", key).containsKey(key);
			current = (Map<String, Object>) current.get(key);
		}
		return current;
	}

	private static DefaultPrettyPrinter prettyPrinter() {
		var indenter = new DefaultIndenter("  ", "\n");
		var printer = new DefaultPrettyPrinter();
		printer.indentObjectsWith(indenter);
		printer.indentArraysWith(indenter);
		return printer;
	}

}
