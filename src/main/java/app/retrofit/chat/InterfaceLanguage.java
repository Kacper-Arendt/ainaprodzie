package app.retrofit.chat;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;

import org.jspecify.annotations.Nullable;

/// The languages of the user interface, by their language tags. English is the default.
enum InterfaceLanguage {

	EN("en"),

	PL("pl");

	private static final List<String> TAGS = Arrays.stream(values()).map(InterfaceLanguage::tag).toList();

	private final String tag;

	InterfaceLanguage(String tag) {
		this.tag = tag;
	}

	/// The tag as the context block names the language, such as `pl`.
	String tag() {
		return tag;
	}

	/// The language the SPA sends in `Accept-Language`, its current one; anything else falls back to the default.
	static InterfaceLanguage fromAcceptLanguage(@Nullable String acceptLanguage) {
		if (acceptLanguage == null || acceptLanguage.isBlank()) {
			return EN;
		}
		try {
			var match = Locale.lookupTag(Locale.LanguageRange.parse(acceptLanguage), TAGS);
			return Arrays.stream(values()).filter(language -> language.tag.equalsIgnoreCase(match)).findFirst()
					.orElse(EN);
		}
		catch (IllegalArgumentException ex) {
			return EN;
		}
	}

}
