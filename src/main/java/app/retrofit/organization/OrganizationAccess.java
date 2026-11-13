package app.retrofit.organization;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;

/// Support sees every organization; a customer sees only their own, and never queries another one's id.
@Service
class OrganizationAccess {

	private final JdbcOrganizationRepository organizations;

	OrganizationAccess(JdbcOrganizationRepository organizations) {
		this.organizations = organizations;
	}

	List<Organization> visibleTo(Caller caller) {
		return switch (caller) {
			case Caller.Support _ -> organizations.findAll();
			case Caller.Customer(var _, var organizationId) -> organizations.findById(organizationId).stream().toList();
		};
	}

	Organization get(Caller caller, UUID id) {
		var organization = switch (caller) {
			case Caller.Support _ -> organizations.findById(id);
			case Caller.Customer(var _, var organizationId) ->
				organizationId.equals(id) ? organizations.findById(id) : Optional.<Organization>empty();
		};
		return organization.orElseThrow(OrganizationProblems::notFound);
	}

}
