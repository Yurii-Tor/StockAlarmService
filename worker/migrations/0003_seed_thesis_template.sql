-- The §C.3 thesis template, seeded verbatim from the specification.
--
-- `user_id` is NULL, which marks it as system-provided: every account sees it,
-- nobody owns it, and a user editing it creates their own copy rather than
-- mutating the shared one.
--
-- One row. Named explicitly rather than generated at runtime so the text is
-- reviewable in the repository and cannot drift from the spec silently.

INSERT OR IGNORE INTO `thesis_templates`
  (`id`, `user_id`, `name`, `body`, `is_default`, `created_at`, `updated_at`)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  NULL,
  'Long-term investment',
  'Why I am interested / bought:

Expected outcome / catalyst:

Base target:

Main risks:

What would invalidate this idea:

What I will review on the next date:
',
  1,
  0,
  0
);
