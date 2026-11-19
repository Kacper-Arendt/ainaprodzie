package app.retrofit.chat;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

/// LiteLLM's Presidio guardrail masks personal data before a request reaches the provider (chat ADR 0017). An alias
/// without it sends a question's personal data as it is, and an analyzer without the PESEL recognizer for English finds
/// no PESEL.
class PersonalDataGuardrailTests {

	/// The guardrail of `litellm/config.yaml`.
	private static final String GUARDRAIL = "personal-data";

	private static final String APP_GROUP = "app";

	@Test
	void everyAliasTheAppCallsHasTheGuardrail() throws IOException {
		assertThat(models()).filteredOn(model -> groups(model).contains(APP_GROUP))
			.isNotEmpty()
			.allSatisfy(model -> assertThat(guardrails(model)).as(alias(model)).contains(GUARDRAIL));
	}

	@Test
	void theGuardrailMasksPatternDataButPeopleAndBlocksCardNumbers() throws IOException {
		assertThat(guardrailParameters().get("pii_entities_config")).isEqualTo(Map.of("EMAIL_ADDRESS", "MASK",
				"PHONE_NUMBER", "MASK", "IBAN_CODE", "MASK", "CREDIT_CARD", "BLOCK", "PL_PESEL", "MASK"));
	}

	@Test
	@SuppressWarnings("unchecked")
	void theAnalyzerFindsAPeselInEnglish() throws IOException {
		Map<String, Object> registry = new Yaml().load(Files.readString(Path.of("presidio", "recognizers.yaml")));

		assertThat((List<Map<String, Object>>) registry.get("recognizers"))
			.filteredOn(recognizer -> "PlPeselRecognizer".equals(recognizer.get("name")))
			.singleElement()
			.satisfies(recognizer -> assertThat(recognizer.get("supported_languages")).isEqualTo(List.of("en")));
	}

	/// LiteLLM's own `presidio` refuses a question that holds some IBANs: Presidio finds a card number inside them.
	@Test
	void theGuardrailIsTheClassThatTakesNoPartOfAnIbanForACardNumber() throws IOException {
		assertThat(guardrailParameters().get("guardrail")).isEqualTo("personal_data_guardrail.PersonalDataGuardrail");
	}

	/// LiteLLM loads the class from a file next to its `config.yaml`, and does not start without it.
	@Test
	@SuppressWarnings("unchecked")
	void composeMountsTheGuardrailsClassNextToLiteLlmsConfig() throws IOException {
		Map<String, Object> compose = new Yaml().load(Files.readString(Path.of("compose.yaml")));
		var litellm = ((Map<String, Map<String, Object>>) compose.get("services")).get("litellm");

		assertThat(Path.of("litellm", "personal_data_guardrail.py")).isRegularFile();
		assertThat((List<String>) litellm.get("volumes"))
			.contains("./litellm/personal_data_guardrail.py:/app/personal_data_guardrail.py:ro");
	}

	private static Map<String, Object> config() throws IOException {
		return new Yaml().load(Files.readString(Path.of("litellm", "config.yaml")));
	}

	@SuppressWarnings("unchecked")
	private static List<Map<String, Object>> models() throws IOException {
		return (List<Map<String, Object>>) config().get("model_list");
	}

	@SuppressWarnings("unchecked")
	private static Map<String, Object> guardrailParameters() throws IOException {
		var guardrails = (List<Map<String, Object>>) config().getOrDefault("guardrails", List.of());
		return guardrails.stream()
			.filter(guardrail -> GUARDRAIL.equals(guardrail.get("guardrail_name")))
			.map(guardrail -> (Map<String, Object>) guardrail.get("litellm_params"))
			.findFirst()
			.orElseThrow(() -> new AssertionError("litellm/config.yaml has no guardrail " + GUARDRAIL));
	}

	private static String alias(Map<String, Object> model) {
		return (String) model.get("model_name");
	}

	@SuppressWarnings("unchecked")
	private static List<String> groups(Map<String, Object> model) {
		var info = (Map<String, Object>) model.getOrDefault("model_info", Map.of());
		return (List<String>) info.getOrDefault("access_groups", List.of());
	}

	@SuppressWarnings("unchecked")
	private static List<String> guardrails(Map<String, Object> model) {
		var parameters = (Map<String, Object>) model.getOrDefault("litellm_params", Map.of());
		return (List<String>) parameters.getOrDefault("guardrails", List.of());
	}

}
