CREATE SCHEMA catalogue;
REVOKE ALL ON SCHEMA catalogue FROM PUBLIC;

CREATE TYPE catalogue.template_type AS ENUM (
  'ingredient',
  'option-set',
  'item',
  'bundle',
  'category',
  'cuisine-pack'
);
CREATE TYPE catalogue.quality_status AS ENUM ('draft', 'reviewed');
CREATE TYPE catalogue.revision_event_type AS ENUM ('PUBLISHED', 'WITHDRAWN');

CREATE TABLE catalogue.template (
  template_id text PRIMARY KEY
    CHECK (template_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  type catalogue.template_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalogue.revision (
  template_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  type catalogue.template_type NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  description text,
  cuisines text[] NOT NULL DEFAULT '{}',
  source_locale text NOT NULL,
  translations jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(translations) = 'object'),
  locale_fallbacks text[] NOT NULL DEFAULT '{}',
  dependencies jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(dependencies) = 'array'),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
  quality_status catalogue.quality_status NOT NULL,
  compatible_tenant_contract_versions integer[] NOT NULL DEFAULT '{}',
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  search_text text NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, revision),
  FOREIGN KEY (template_id) REFERENCES catalogue.template(template_id)
);

CREATE TABLE catalogue.revision_event (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id text NOT NULL,
  revision integer,
  event_type catalogue.revision_event_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (template_id, revision)
    REFERENCES catalogue.revision(template_id, revision),
  CHECK (event_type = 'WITHDRAWN' OR revision IS NOT NULL)
);

CREATE INDEX catalogue_revision_type_idx ON catalogue.revision(type, template_id);
CREATE INDEX catalogue_revision_cuisines_idx ON catalogue.revision USING gin(cuisines);
CREATE INDEX catalogue_revision_search_idx
  ON catalogue.revision USING gin(to_tsvector('simple', search_text));
CREATE INDEX catalogue_revision_event_lookup_idx
  ON catalogue.revision_event(template_id, revision, event_id DESC);

CREATE FUNCTION catalogue.reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'catalogue content is immutable; publish a new revision';
END;
$$;

CREATE TRIGGER catalogue_template_immutable
  BEFORE UPDATE OR DELETE ON catalogue.template
  FOR EACH ROW EXECUTE FUNCTION catalogue.reject_immutable_mutation();
CREATE TRIGGER catalogue_revision_immutable
  BEFORE UPDATE OR DELETE ON catalogue.revision
  FOR EACH ROW EXECUTE FUNCTION catalogue.reject_immutable_mutation();
CREATE TRIGGER catalogue_event_immutable
  BEFORE UPDATE OR DELETE ON catalogue.revision_event
  FOR EACH ROW EXECUTE FUNCTION catalogue.reject_immutable_mutation();

CREATE VIEW catalogue.public_revision WITH (security_barrier = true) AS
WITH latest_global_withdrawal AS (
  SELECT template_id, max(event_id) AS event_id
  FROM catalogue.revision_event
  WHERE event_type = 'WITHDRAWN' AND revision IS NULL
  GROUP BY template_id
),
latest_revision_event AS (
  SELECT DISTINCT ON (template_id, revision)
    template_id, revision, event_type, event_id
  FROM catalogue.revision_event
  WHERE revision IS NOT NULL
  ORDER BY template_id, revision, event_id DESC
)
SELECT revision.*
FROM catalogue.revision AS revision
JOIN latest_revision_event AS event
  ON event.template_id = revision.template_id
 AND event.revision = revision.revision
LEFT JOIN latest_global_withdrawal AS withdrawn
  ON withdrawn.template_id = revision.template_id
WHERE event.event_type = 'PUBLISHED'
  AND revision.quality_status = 'reviewed'
  AND event.event_id > COALESCE(withdrawn.event_id, 0);

CREATE VIEW catalogue.public_current WITH (security_barrier = true) AS
SELECT DISTINCT ON (template_id) *
FROM catalogue.public_revision
ORDER BY template_id, revision DESC;

GRANT USAGE ON SCHEMA catalogue TO sofra_catalogue_reader;
GRANT SELECT ON catalogue.public_revision, catalogue.public_current TO sofra_catalogue_reader;
