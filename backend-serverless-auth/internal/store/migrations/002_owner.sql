-- Every plant belongs to the Cognito user (the token's "sub") who created it.
-- Rows that existed before authentication stay with owner '' and are visible to admins only.
ALTER TABLE plants ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
CREATE INDEX plants_owner_id_idx ON plants(owner_id);
