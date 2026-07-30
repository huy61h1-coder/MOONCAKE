/*
# AEON Mooncake cloud state

Migrates the storefront/admin data that previously lived in a local
`.aeon-store.json` file into Supabase so the app can be deployed on a
static host (Netlify) and still persist products, UI settings, layout,
customers and orders in the cloud.

1. New Tables
- `aeon_state` — single-row key/value store mirroring the old flat file.
  - `key` (text, primary key): one of `aeon-products`, `aeon-ui`,
    `aeon-layout`, `aeon-customers`, `aeon-orders`.
  - `value` (jsonb): the full JSON blob for that key.
  - `updated_at` (timestamptz): last write time, used by the storefront
    polling loop to detect remote changes cheaply.

2. Security
- Enable RLS on `aeon_state`.
- The app has NO sign-in screen (admin login is a hardcoded browser-only
  credential stored in sessionStorage), so the data is intentionally
  shared/public. All four CRUD verbs are open to `anon, authenticated`
  so the anon-key frontend can read and write its own data. This matches
  the previous `/api/state` endpoint, which had no access control.
*/

CREATE TABLE IF NOT EXISTS aeon_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE aeon_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_aeon_state" ON aeon_state;
CREATE POLICY "anon_select_aeon_state" ON aeon_state FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_aeon_state" ON aeon_state;
CREATE POLICY "anon_insert_aeon_state" ON aeon_state FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_aeon_state" ON aeon_state;
CREATE POLICY "anon_update_aeon_state" ON aeon_state FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_aeon_state" ON aeon_state;
CREATE POLICY "anon_delete_aeon_state" ON aeon_state FOR DELETE
  TO anon, authenticated USING (true);
