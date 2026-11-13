package app.retrofit.ticket;

/// A ticket's entity tag is its version in quotes, `"7"`.
final class EntityTags {

	private EntityTags() {
	}

	static String format(long version) {
		return "\"" + version + "\"";
	}

	/// Only the exact current tag matches: `*`, a weak tag and a list of tags never do.
	static boolean matches(String ifMatch, long version) {
		return ifMatch.equals(format(version));
	}

}
