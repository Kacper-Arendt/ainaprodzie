package app.retrofit.ticket;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import org.jspecify.annotations.Nullable;

/// Builds a [TicketFilter] one criterion at a time, every criterion absent unless set. It is mutable, so each filter
/// starts from a new builder.
final class FilterBuilder {

	private @Nullable String text;

	private @Nullable UUID organizationId;

	private Set<TicketStatus> statuses = Set.of();

	private Set<TicketCategory> categories = Set.of();

	private Set<TicketPriority> priorities = Set.of();

	private @Nullable UUID teamId;

	private @Nullable UUID assigneeId;

	private @Nullable Boolean slaBreached;

	private @Nullable UUID authorId;

	private @Nullable Instant createdFrom;

	private @Nullable Instant createdTo;

	private @Nullable Instant deadlineBefore;

	private @Nullable Attention attention;

	TicketFilter build() {
		return new TicketFilter(text, organizationId, statuses, categories, priorities, teamId, assigneeId,
				slaBreached, authorId, createdFrom, createdTo, deadlineBefore, attention);
	}

	FilterBuilder withText(String text) {
		this.text = text;
		return this;
	}

	FilterBuilder withOrganization(UUID organizationId) {
		this.organizationId = organizationId;
		return this;
	}

	FilterBuilder withStatuses(Set<TicketStatus> statuses) {
		this.statuses = statuses;
		return this;
	}

	FilterBuilder withCategories(Set<TicketCategory> categories) {
		this.categories = categories;
		return this;
	}

	FilterBuilder withPriorities(Set<TicketPriority> priorities) {
		this.priorities = priorities;
		return this;
	}

	FilterBuilder withTeam(UUID teamId) {
		this.teamId = teamId;
		return this;
	}

	FilterBuilder withAssignee(UUID assigneeId) {
		this.assigneeId = assigneeId;
		return this;
	}

	FilterBuilder withSlaBreached(boolean slaBreached) {
		this.slaBreached = slaBreached;
		return this;
	}

	FilterBuilder withAuthor(UUID authorId) {
		this.authorId = authorId;
		return this;
	}

	FilterBuilder withCreatedFrom(Instant createdFrom) {
		this.createdFrom = createdFrom;
		return this;
	}

	FilterBuilder withCreatedTo(Instant createdTo) {
		this.createdTo = createdTo;
		return this;
	}

	FilterBuilder withDeadlineBefore(Instant deadlineBefore) {
		this.deadlineBefore = deadlineBefore;
		return this;
	}

	FilterBuilder withAttention(Attention attention) {
		this.attention = attention;
		return this;
	}

}
