-- Per-song shift of the lyrics in milliseconds (> 0 shows them later).
ALTER TABLE lyrics ADD COLUMN offset_ms INTEGER NOT NULL DEFAULT 0;