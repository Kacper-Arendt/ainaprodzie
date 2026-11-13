package app.retrofit.ticket;

import java.util.Optional;
import java.util.regex.Pattern;

record TicketReference(long number) {

	private static final Pattern FORMAT = Pattern.compile("(?i)RET-(\\d{1,18})");

	static Optional<TicketReference> parse(String text) {
		var matcher = FORMAT.matcher(text.strip());
		return matcher.matches() ? Optional.of(new TicketReference(Long.parseLong(matcher.group(1))))
				: Optional.empty();
	}

	@Override
	public String toString() {
		return "RET-" + number;
	}

}
