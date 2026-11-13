-- One CREATED audit entry per demo ticket: by its author, at its creation time, with the title as the new value.

INSERT INTO ticket_audit_entry (id, ticket_id, actor_id, changed_at, field, old_value, new_value)
SELECT gen_random_uuid(), t.id, t.author_id, t.created_at, 'CREATED', NULL, t.title
FROM ticket t
WHERE t.organization_id IN ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000b0002',
    '00000000-0000-0000-0000-0000000b0003');
