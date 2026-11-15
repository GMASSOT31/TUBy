-- TUBy : schéma initial (Cloudflare D1 / SQLite)
CREATE TABLE students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prenom TEXT NOT NULL,
  prenom_key TEXT NOT NULL,            -- prénom normalisé (minuscules, sans accents) pour la connexion
  code_hash TEXT NOT NULL DEFAULT '',  -- "sel$hmac" ; vide = aucun code valide
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_students_key ON students(prenom_key);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL          -- secondes Unix
);

CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,                -- "s:<prénom>" ou "a:<ip>"
  fails INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE guides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titre TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  titre TEXT NOT NULL,
  objectif TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_chapters_guide ON chapters(guide_id, position);

CREATE TABLE steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('prerequis','action','verif','choix','recap')),
  ref TEXT NOT NULL,                   -- identifiant stable dans le guide, cible des "goto" et "apres"
  titre TEXT NOT NULL DEFAULT '',
  objectif TEXT NOT NULL DEFAULT '',
  quoi_faire TEXT NOT NULL DEFAULT '',
  config TEXT NOT NULL DEFAULT '{}',   -- JSON selon le type
  only_for_assignment_id INTEGER,      -- null = pour tous ; sinon étape d'aide propre à un élève
  inserted_before_step_id INTEGER,
  help_request_id INTEGER              -- blocage à l'origine de cette étape d'aide
);
CREATE INDEX idx_steps_chapter ON steps(chapter_id, position);
CREATE INDEX idx_steps_only_for ON steps(only_for_assignment_id);

CREATE TABLE assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  current_step_id INTEGER,
  status TEXT NOT NULL DEFAULT 'en_cours' CHECK (status IN ('en_cours','en_pause','bloque','termine')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (guide_id, student_id)
);
CREATE INDEX idx_assignments_student ON assignments(student_id);

CREATE TABLE step_progress (
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  step_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('fait','passe')),
  answer TEXT,                         -- JSON : choix tapé, cases cochées…
  done_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (assignment_id, step_id)
);

CREATE TABLE help_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  step_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'ouvert' CHECK (status IN ('ouvert','traite')),
  admin_reply TEXT,
  resolved_at TEXT,
  seen_at TEXT                         -- l'élève a vu la réponse
);
CREATE INDEX idx_help_assignment ON help_requests(assignment_id, status);
CREATE INDEX idx_help_status ON help_requests(status);
