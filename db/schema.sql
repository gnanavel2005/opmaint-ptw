-- Permit to Work schema (Postgres). Run once: psql "$DATABASE_URL" -f db/schema.sql
CREATE TYPE user_role AS ENUM ('REQUESTER','AREA_OWNER','SAFETY_OFFICER','ADMIN');
CREATE TYPE permit_status AS ENUM ('DRAFT','PENDING_APPROVAL','APPROVED','ACTIVE','SUSPENDED',
  'REJECTED','EXPIRED','CLOSED','CLOSED_VERIFIED','CANCELLED');

CREATE TABLE plants (id serial PRIMARY KEY, name text NOT NULL);
CREATE TABLE areas  (id serial PRIMARY KEY, plant_id int NOT NULL REFERENCES plants, name text NOT NULL);
CREATE TABLE users  (id serial PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL,
  password_hash text NOT NULL, role user_role NOT NULL);
CREATE TABLE user_areas (user_id int REFERENCES users, area_id int REFERENCES areas, PRIMARY KEY (user_id, area_id)); -- area owners
CREATE TABLE equipment (id serial PRIMARY KEY, area_id int NOT NULL REFERENCES areas, tag text UNIQUE NOT NULL, name text NOT NULL);

-- One shared permit entity. Type-specific fields live in type_data (jsonb) and are validated
-- by src/domain/permitTypes.ts, so a 5th type (Excavation) needs no migration.
CREATE TABLE permits (
  id serial PRIMARY KEY,
  permit_no text UNIQUE NOT NULL,
  type text NOT NULL,
  status permit_status NOT NULL DEFAULT 'DRAFT',
  requester_id int NOT NULL REFERENCES users,
  contractor text NOT NULL,
  work_description text NOT NULL,
  area_id int NOT NULL REFERENCES areas,
  equipment_id int REFERENCES equipment,
  planned_start timestamptz NOT NULL,
  planned_end timestamptz NOT NULL,
  hazards text[] NOT NULL DEFAULT '{}',
  ppe text[] NOT NULL DEFAULT '{}',
  precautions jsonb NOT NULL DEFAULT '[]',   -- [{text, done}]
  type_data jsonb NOT NULL DEFAULT '{}',
  completion_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (planned_end > planned_start)
);
CREATE INDEX permits_status_end_idx ON permits (status, planned_end);

-- One row per required approver slot, created on submit.
CREATE TABLE permit_approvals (
  id serial PRIMARY KEY,
  permit_id int NOT NULL REFERENCES permits,
  slot user_role NOT NULL CHECK (slot IN ('AREA_OWNER','SAFETY_OFFICER')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  approver_id int REFERENCES users,
  comment text,
  signature text,            -- data URL from the canvas, optional
  decided_at timestamptz,
  UNIQUE (permit_id, slot)
);

-- Append-only audit log. The triggers make it immutable even for the app's own DB user.
CREATE TABLE permit_audit_log (
  id bigserial PRIMARY KEY,
  permit_id int NOT NULL REFERENCES permits,
  actor_id int REFERENCES users,           -- NULL = system (auto-expiry)
  action text NOT NULL,
  from_status permit_status,
  to_status permit_status,
  field text, from_value jsonb, to_value jsonb,   -- for field edits after submission
  comment text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION audit_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'permit_audit_log is append-only'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON permit_audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_append_only();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON permit_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only();
