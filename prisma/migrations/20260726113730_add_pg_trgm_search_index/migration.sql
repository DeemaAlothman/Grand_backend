-- Enable trigram matching for fast ILIKE/contains text search on Arabic & Latin product names.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS products_name_trgm_idx ON products USING GIN (name gin_trgm_ops);
