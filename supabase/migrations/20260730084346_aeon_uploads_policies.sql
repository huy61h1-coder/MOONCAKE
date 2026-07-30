/*
# AEON uploads storage bucket policies

Makes the `aeon-uploads` public bucket usable by the anon-key frontend
(no sign-in screen, so uploads are intentionally public, matching the
previous `/api/upload` endpoint which had no access control).

1. Security
- SELECT (read) open to anon + authenticated — public bucket.
- INSERT (upload) open to anon + authenticated.
- UPDATE / DELETE open to anon + authenticated.
*/

DROP POLICY IF EXISTS "anon_read_aeon_uploads" ON storage.objects;
CREATE POLICY "anon_read_aeon_uploads" ON storage.objects FOR SELECT
  TO anon, authenticated USING (bucket_id = 'aeon-uploads');

DROP POLICY IF EXISTS "anon_insert_aeon_uploads" ON storage.objects;
CREATE POLICY "anon_insert_aeon_uploads" ON storage.objects FOR INSERT
  TO anon, authenticated WITH CHECK (bucket_id = 'aeon-uploads');

DROP POLICY IF EXISTS "anon_update_aeon_uploads" ON storage.objects;
CREATE POLICY "anon_update_aeon_uploads" ON storage.objects FOR UPDATE
  TO anon, authenticated USING (bucket_id = 'aeon-uploads') WITH CHECK (bucket_id = 'aeon-uploads');

DROP POLICY IF EXISTS "anon_delete_aeon_uploads" ON storage.objects;
CREATE POLICY "anon_delete_aeon_uploads" ON storage.objects FOR DELETE
  TO anon, authenticated USING (bucket_id = 'aeon-uploads');
