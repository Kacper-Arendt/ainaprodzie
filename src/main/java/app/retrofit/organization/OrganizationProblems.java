package app.retrofit.organization;

import app.retrofit.platform.ProblemException;

final class OrganizationProblems {

	private OrganizationProblems() {
	}

	/// The one body for an unknown id and for another organization's id, so neither reveals which it was.
	static ProblemException notFound() {
		return ProblemException.notFound("organization/not-found", "Organization not found",
				"The organization was not found.");
	}

}
