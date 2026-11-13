package app.retrofit.ticket;

/// What a stored link says, spelled exactly as the `ticket_link_type_check` constraint spells it. A potential duplicate
/// is stored from the later ticket to the earlier one; [LinkRelation] is how either end reads it.
enum LinkType {

	RELATED, POTENTIAL_DUPLICATE

}
