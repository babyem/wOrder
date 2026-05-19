-- Add hide_unit flag to vendors table
-- When true, unit is omitted from supplier notification messages
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS hide_unit boolean NOT NULL DEFAULT false;
