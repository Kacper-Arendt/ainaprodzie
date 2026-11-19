package app.retrofit.chat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

import org.springframework.core.io.Resource;

/// The chat's system prompt, the same text for every request so it stays a cacheable prefix, and its version: the
/// first 12 hex digits of the SHA-256 of the file (chat ADR 0008). A changed prompt gets a new version by itself.
record SystemPrompt(String name, String text, String version) {

	static SystemPrompt read(String name, Resource resource) {
		try {
			var bytes = resource.getContentAsByteArray();
			var digest = MessageDigest.getInstance("SHA-256").digest(bytes);
			return new SystemPrompt(name, new String(bytes, StandardCharsets.UTF_8),
					HexFormat.of().formatHex(digest).substring(0, 12));
		}
		catch (IOException ex) {
			throw new UncheckedIOException("The system prompt " + name + " cannot be read", ex);
		}
		catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException("Every JVM provides SHA-256", ex);
		}
	}

}
