CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  category TEXT NOT NULL,
  feature TEXT,
  message TEXT NOT NULL,
  email TEXT,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','planned','completed','declined'))
);
CREATE INDEX IF NOT EXISTS feedback_date ON feedback(createdAt, id);
