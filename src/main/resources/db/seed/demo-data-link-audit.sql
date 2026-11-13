-- Aligns the demo links' audit history with what a live link writes: an entry on both tickets, each naming the
-- relation as that ticket reads it, and the linked ticket's last-update time no earlier than the link.
-- Avoid semicolons inside string literals: Liquibase splits this file on them.

UPDATE ticket_audit_entry a
SET new_value = regexp_replace(a.new_value, '^POTENTIAL_DUPLICATE ', 'POTENTIAL_DUPLICATE_OF ')
FROM ticket t
WHERE t.id = a.ticket_id
  AND t.organization_id IN ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000b0002',
                            '00000000-0000-0000-0000-0000000b0003')
  AND a.field = 'LINK'
  AND a.new_value ~ '^POTENTIAL_DUPLICATE RET-[0-9]+$';

INSERT INTO ticket_audit_entry (id, ticket_id, actor_id, changed_at, field, old_value, new_value)
SELECT gen_random_uuid(), l.linked_ticket_id, l.created_by, l.created_at, 'LINK', NULL,
       CASE WHEN l.type = 'RELATED' THEN 'RELATED' ELSE 'HAS_POTENTIAL_DUPLICATE' END || ' RET-' || t.number
FROM ticket_link l
JOIN ticket t ON t.id = l.ticket_id
WHERE t.organization_id IN ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000b0002',
                            '00000000-0000-0000-0000-0000000b0003');

UPDATE ticket linked
SET updated_at = greatest(linked.updated_at, l.created_at)
FROM ticket_link l
JOIN ticket t ON t.id = l.ticket_id
WHERE linked.id = l.linked_ticket_id
  AND t.organization_id IN ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000b0002',
                            '00000000-0000-0000-0000-0000000b0003');
