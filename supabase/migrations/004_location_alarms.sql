CREATE TABLE IF NOT EXISTS location_alarms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Alarm',
  time text NOT NULL DEFAULT '09:00',
  days integer[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE location_alarms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public access" ON location_alarms;
CREATE POLICY "Public access" ON location_alarms FOR ALL USING (true) WITH CHECK (true);
