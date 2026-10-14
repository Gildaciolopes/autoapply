-- pgvector in app DB and template1 (so Prisma shadow DBs also get it)
CREATE EXTENSION IF NOT EXISTS vector;
\c template1
CREATE EXTENSION IF NOT EXISTS vector;
