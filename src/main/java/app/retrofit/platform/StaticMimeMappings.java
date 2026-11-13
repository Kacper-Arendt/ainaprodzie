package app.retrofit.platform;

import org.springframework.boot.web.server.MimeMappings;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.boot.web.server.servlet.ConfigurableServletWebServerFactory;
import org.springframework.stereotype.Component;

/// Serves `.webmanifest` as `application/manifest+json`. Neither the servlet container's MIME table nor
/// Spring's own `mime.types` knows the extension, so it would otherwise go out as
/// `application/octet-stream`.
@Component
class StaticMimeMappings implements WebServerFactoryCustomizer<ConfigurableServletWebServerFactory> {

	static final String MANIFEST_TYPE = "application/manifest+json";

	@Override
	public void customize(ConfigurableServletWebServerFactory factory) {
		var mappings = new MimeMappings(MimeMappings.DEFAULT);
		mappings.add("webmanifest", MANIFEST_TYPE);
		factory.setMimeMappings(mappings);
	}

}
