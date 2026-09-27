-- Publish only the status of revisions that were reviewed and published at
-- least once. Drafts and never-published template IDs remain private.
CREATE VIEW catalogue.public_revision_status WITH (security_barrier = true) AS
WITH published_once AS (
  SELECT DISTINCT template_id, revision
  FROM catalogue.revision_event
  WHERE event_type = 'PUBLISHED'
),
latest_revision_event AS (
  SELECT DISTINCT ON (template_id, revision)
    template_id, revision, event_type, event_id
  FROM catalogue.revision_event
  WHERE revision IS NOT NULL
  ORDER BY template_id, revision, event_id DESC
),
latest_global_withdrawal AS (
  SELECT template_id, max(event_id) AS event_id
  FROM catalogue.revision_event
  WHERE event_type = 'WITHDRAWN' AND revision IS NULL
  GROUP BY template_id
)
SELECT revision.template_id, revision.revision, revision.content_hash,
  NOT (
    event.event_type = 'PUBLISHED'
    AND event.event_id > COALESCE(global_withdrawal.event_id, 0)
  ) AS withdrawn
FROM published_once AS published
JOIN catalogue.revision AS revision
  ON revision.template_id = published.template_id
 AND revision.revision = published.revision
JOIN latest_revision_event AS event
  ON event.template_id = revision.template_id
 AND event.revision = revision.revision
LEFT JOIN latest_global_withdrawal AS global_withdrawal
  ON global_withdrawal.template_id = revision.template_id
WHERE revision.quality_status = 'reviewed';

CREATE VIEW catalogue.public_current_status WITH (security_barrier = true) AS
WITH last_published AS (
  SELECT DISTINCT template_id
  FROM catalogue.public_revision_status
)
SELECT previous.template_id,
  current.revision,
  current.content_hash,
  current.template_id IS NULL AS withdrawn
FROM last_published AS previous
LEFT JOIN catalogue.public_current AS current
  ON current.template_id = previous.template_id;

GRANT SELECT ON catalogue.public_revision_status,
  catalogue.public_current_status TO sofra_catalogue_reader;
