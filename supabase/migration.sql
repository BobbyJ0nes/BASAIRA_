-- ═══════════════════════════════════════════════════════════
-- BASAIRA_ — Supabase Database Migration
-- ═══════════════════════════════════════════════════════════
-- Paste this entire file into the Supabase SQL Editor and click Run.

-- Papers table
CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  authors TEXT[] DEFAULT '{}',
  abstract TEXT DEFAULT '',
  published TIMESTAMPTZ,
  categories TEXT[] DEFAULT '{}',
  domains TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  is_overlap BOOLEAN DEFAULT false,
  arxiv_url TEXT,
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Edges table (paper relationships)
CREATE TABLE IF NOT EXISTS edges (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  target TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  weight REAL DEFAULT 0,
  shared_tags TEXT[] DEFAULT '{}',
  UNIQUE(source, target)
);

-- Full text content cache
CREATE TABLE IF NOT EXISTS paper_content (
  paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  sections JSONB DEFAULT '[]',
  source TEXT DEFAULT 'abstract',
  total_chars INTEGER DEFAULT 0,
  fetched_at TIMESTAMPTZ DEFAULT now()
);

-- Concept cache (AI-extracted concepts per paper)
CREATE TABLE IF NOT EXISTS paper_concepts (
  paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  concepts JSONB DEFAULT '[]',
  extracted_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_concepts ENABLE ROW LEVEL SECURITY;

-- Public read access (no auth required for a personal research tool)
CREATE POLICY "public read papers" ON papers FOR SELECT TO anon USING (true);
CREATE POLICY "public read edges" ON edges FOR SELECT TO anon USING (true);
CREATE POLICY "public read content" ON paper_content FOR SELECT TO anon USING (true);
CREATE POLICY "public read concepts" ON paper_concepts FOR SELECT TO anon USING (true);

-- Service role gets full access (for server-side writes)
CREATE POLICY "service write papers" ON papers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service write edges" ON edges FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service write content" ON paper_content FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service write concepts" ON paper_concepts FOR ALL USING (true) WITH CHECK (true);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_papers_domains ON papers USING GIN (domains);
CREATE INDEX IF NOT EXISTS idx_papers_tags ON papers USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges (source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges (target);
