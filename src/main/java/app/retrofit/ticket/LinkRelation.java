package app.retrofit.ticket;

/// How a linked ticket relates to the ticket being read. A potential duplicate link points from the later ticket to
/// the earlier one, so it reads differently from each end.
enum LinkRelation {

	RELATED,

	POTENTIAL_DUPLICATE_OF,

	HAS_POTENTIAL_DUPLICATE

}
