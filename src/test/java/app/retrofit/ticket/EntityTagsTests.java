package app.retrofit.ticket;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class EntityTagsTests {

	@Test
	void tagIsTheQuotedVersion() {
		assertThat(EntityTags.format(0)).isEqualTo("\"0\"");
		assertThat(EntityTags.format(42)).isEqualTo("\"42\"");
	}

	@Test
	void onlyTheExactCurrentTagMatches() {
		assertThat(EntityTags.matches("\"7\"", 7)).isTrue();
		assertThat(EntityTags.matches("\"6\"", 7)).isFalse();
		assertThat(EntityTags.matches("7", 7)).isFalse();
		assertThat(EntityTags.matches("*", 7)).isFalse();
		assertThat(EntityTags.matches("W/\"7\"", 7)).isFalse();
		assertThat(EntityTags.matches("\"7\", \"8\"", 7)).isFalse();
	}

}
