package app.retrofit.platform;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Controller;
import org.springframework.web.ErrorResponseException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

/// SPA deep-link fallback: browser routes such as /login or /tickets/123 are forwarded to the bundled index.html so
/// client-side routing can take over. Never masks `/api/**`, `/actuator/**` or file requests: those keep their real
/// responses, problem+json 404s included.
@Controller
class SpaFallbackController {

	private static final String EXCLUDED_FIRST_SEGMENT = "^(?!api$|actuator$|assets$)[^.]*$";

	@GetMapping({ "/{path:" + EXCLUDED_FIRST_SEGMENT + "}",
			"/{path:" + EXCLUDED_FIRST_SEGMENT + "}/{*rest}" })
	String forwardToSpa(@PathVariable String path, @PathVariable(required = false) String rest) {
		if (rest != null && rest.substring(rest.lastIndexOf('/') + 1).contains(".")) {
			// Looks like a file request: a missing file must 404, not render the shell.
			throw new ErrorResponseException(HttpStatus.NOT_FOUND);
		}
		return "forward:/index.html";
	}

}
