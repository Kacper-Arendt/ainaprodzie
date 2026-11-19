package app.retrofit.chat;

import static org.assertj.core.api.Assertions.assertThatCode;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.output.ToStringConsumer;
import org.testcontainers.containers.startupcheck.OneShotStartupCheckStrategy;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;
import org.yaml.snakeyaml.Yaml;

/// The rule of `litellm/personal_data_guardrail.py`, that a card number Presidio finds inside an IBAN does not refuse a
/// request (chat ADR 0017), checked by `litellm/test_personal_data_guardrail.py` in the LiteLLM image `compose.yaml`
/// runs. The Python test goes through LiteLLM's own `check_pii`, so it also fails when a new LiteLLM stops calling the
/// method the class overrides.
class PersonalDataGuardrailClassTests {

	private static final String TESTS = "/tests/";

	@Test
	void aCardNumberInsideAnIbanDoesNotRefuseTheRequestAndOneElsewhereDoes() throws IOException {
		var output = new ToStringConsumer();
		try (var litellm = new GenericContainer<>(DockerImageName.parse(litellmImage()))
			.withCopyFileToContainer(python("personal_data_guardrail.py"), TESTS + "personal_data_guardrail.py")
			.withCopyFileToContainer(python("test_personal_data_guardrail.py"), TESTS + "test_personal_data_guardrail.py")
			.withWorkingDirectory(TESTS)
			.withCreateContainerCmdModifier(command -> command.withEntrypoint("python"))
			.withCommand("-m", "unittest", "-v", "test_personal_data_guardrail")
			.withLogConsumer(output)
			.withStartupCheckStrategy(new OneShotStartupCheckStrategy().withTimeout(Duration.ofMinutes(2)))) {
			assertThatCode(litellm::start).as(output::toUtf8String).doesNotThrowAnyException();
		}
	}

	private static MountableFile python(String file) {
		return MountableFile.forHostPath(Path.of("litellm", file));
	}

	@SuppressWarnings("unchecked")
	private static String litellmImage() throws IOException {
		Map<String, Object> compose = new Yaml().load(Files.readString(Path.of("compose.yaml")));
		var services = (Map<String, Map<String, Object>>) compose.get("services");
		return (String) services.get("litellm").get("image");
	}

}
