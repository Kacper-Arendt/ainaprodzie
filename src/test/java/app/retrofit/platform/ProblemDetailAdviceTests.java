package app.retrofit.platform;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/// The advice on its own, for refusals no production endpoint can trigger yet: stand-in controllers take a typed path
/// variable and throw each generic [ProblemException]. No Spring context, so it does not touch the exported contract.
class ProblemDetailAdviceTests {

	private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new TypedPathController(), new RefusingController())
			.setControllerAdvice(new ProblemDetailAdvice())
			.build();

	@Test
	void aPathVariableThatIsNotAUuidIsAMalformedRequest() throws Exception {
		mvc.perform(get("/things/not-a-uuid"))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
				.andExpect(jsonPath("$.type").value("https://retrofit.app/problems/malformed-request"))
				.andExpect(jsonPath("$.detail").value("The request parameter 'id' could not be read."))
				.andExpect(jsonPath("$.errors").isEmpty());
	}

	@Test
	void aFailedPreconditionCarriesTheCurrentETag() throws Exception {
		mvc.perform(get("/refusals/precondition-failed"))
				.andExpect(status().isPreconditionFailed())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
				.andExpect(header().string("ETag", "\"7\""))
				.andExpect(jsonPath("$.type").value("https://retrofit.app/problems/thing/modified"))
				.andExpect(jsonPath("$.status").value(412))
				.andExpect(jsonPath("$.errors").isEmpty());
	}

	@Test
	void aMissingPreconditionAndAnUnprocessableRequestKeepTheirOwnSlugs() throws Exception {
		mvc.perform(get("/refusals/precondition-required"))
				.andExpect(status().isPreconditionRequired())
				.andExpect(jsonPath("$.type").value("https://retrofit.app/problems/thing/precondition-required"))
				.andExpect(jsonPath("$.errors").isEmpty());
		mvc.perform(get("/refusals/unprocessable"))
				.andExpect(status().isUnprocessableContent())
				.andExpect(jsonPath("$.type").value("https://retrofit.app/problems/thing/key-reused"))
				.andExpect(jsonPath("$.errors").isEmpty());
	}

	@Test
	void forbiddenAndConflictAnswerTheirStatusWithTheirSlugs() throws Exception {
		mvc.perform(get("/refusals/forbidden"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.type").value("https://retrofit.app/problems/thing/forbidden"))
				.andExpect(jsonPath("$.title").value("Forbidden"));
		mvc.perform(get("/refusals/conflict"))
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.type").value("https://retrofit.app/problems/thing/closed"))
				.andExpect(jsonPath("$.detail").value("The thing is closed."));
	}

	/// Nested in a test class, so Spring Boot's test type filter keeps it out of every application context.
	@RestController
	static class TypedPathController {

		@GetMapping("/things/{id}")
		String thing(@PathVariable UUID id) {
			return id.toString();
		}

	}

	@RestController
	static class RefusingController {

		@GetMapping("/refusals/precondition-failed")
		String preconditionFailed() {
			throw ProblemException.preconditionFailed("thing/modified", "Modified", "The thing changed.", "\"7\"");
		}

		@GetMapping("/refusals/precondition-required")
		String preconditionRequired() {
			throw ProblemException.preconditionRequired("thing/precondition-required", "Precondition required",
					"Send If-Match.");
		}

		@GetMapping("/refusals/unprocessable")
		String unprocessable() {
			throw ProblemException.unprocessable("thing/key-reused", "Key reused", "The key was used before.");
		}

		@GetMapping("/refusals/forbidden")
		String forbidden() {
			throw ProblemException.forbidden("thing/forbidden", "Forbidden", "Not yours.");
		}

		@GetMapping("/refusals/conflict")
		String conflict() {
			throw ProblemException.conflict("thing/closed", "Closed", "The thing is closed.");
		}

	}

}
