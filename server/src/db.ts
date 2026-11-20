import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subscribers INTEGER,
  video_count INTEGER,
  view_count INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  thumbnail TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL,
  duration_s INTEGER NOT NULL DEFAULT 0,
  category_id TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  language TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER,
  comments INTEGER,
  source TEXT NOT NULL DEFAULT 'youtube',
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published_at);

CREATE TABLE IF NOT EXISTS video_snapshots (
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  taken_at TEXT NOT NULL,
  views INTEGER NOT NULL,
  likes INTEGER,
  comments INTEGER,
  PRIMARY KEY (video_id, taken_at)
);

CREATE TABLE IF NOT EXISTS niches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS video_niches (
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  niche_id INTEGER NOT NULL REFERENCES niches(id) ON DELETE CASCADE,
  PRIMARY KEY (video_id, niche_id)
);

CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  params TEXT NOT NULL,
  status TEXT NOT NULL,
  found INTEGER NOT NULL DEFAULT 0,
  units_used INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS quota_usage (
  day TEXT PRIMARY KEY,
  units INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  video_id TEXT,
  niche_id INTEGER,
  platforms TEXT NOT NULL DEFAULT '[]',
  stage TEXT NOT NULL DEFAULT 'referencia',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Un análisis y un guion vigentes por proyecto; al regenerar se reemplazan.
CREATE TABLE IF NOT EXISTS analyses (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  model TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Clips de Flow subidos por el usuario (uno por escena) y pista de música opcional.
CREATE TABLE IF NOT EXISTS clips (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  file TEXT NOT NULL,
  original_name TEXT NOT NULL,
  duration_s REAL NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  has_audio INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL,
  PRIMARY KEY (project_id, n)
);

CREATE TABLE IF NOT EXISTS music (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  original_name TEXT NOT NULL,
  duration_s REAL NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL
);

-- Estado del último render de cada proyecto.
CREATE TABLE IF NOT EXISTS renders (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  step TEXT NOT NULL DEFAULT '',
  progress REAL NOT NULL DEFAULT 0,
  error TEXT,
  options TEXT NOT NULL,
  outputs TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS scripts (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  params TEXT NOT NULL,
  model TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

/** Nichos iniciales (consultas pensadas para audiencia hispanohablante). El usuario puede añadir más. */
const BUILTIN_NICHES: Array<{ slug: string; name: string; query: string }> = [
  { slug: 'motivacion', name: 'Motivación y desarrollo personal', query: 'motivación disciplina' },
  { slug: 'finanzas', name: 'Finanzas personales', query: 'finanzas personales ahorro inversión' },
  { slug: 'curiosidades', name: 'Curiosidades y datos', query: 'datos curiosos' },
  { slug: 'historia', name: 'Historia', query: 'historia del mundo' },
  { slug: 'misterio', name: 'Misterio y true crime', query: 'casos misteriosos' },
  { slug: 'ia', name: 'Inteligencia artificial', query: 'inteligencia artificial herramientas' },
  { slug: 'fitness', name: 'Fitness y gimnasio', query: 'rutina gimnasio ejercicio' },
  { slug: 'cocina', name: 'Recetas y cocina', query: 'receta fácil' },
  { slug: 'humor', name: 'Humor y memes', query: 'humor chistes' },
  { slug: 'gaming', name: 'Gaming', query: 'videojuegos' },
  { slug: 'tecnologia', name: 'Tecnología y gadgets', query: 'gadgets tecnología' },
  { slug: 'emprendimiento', name: 'Emprendimiento y negocios', query: 'emprendimiento negocio' },
  { slug: 'salud', name: 'Salud y bienestar', query: 'salud bienestar hábitos' },
  { slug: 'viajes', name: 'Viajes y turismo', query: 'viajes turismo destinos' },
  { slug: 'mascotas', name: 'Mascotas y animales', query: 'mascotas perros gatos' },
  { slug: 'terror', name: 'Terror y relatos', query: 'historias de terror' },
  { slug: 'educacion', name: 'Educación y trucos', query: 'trucos para aprender' },
  { slug: 'autos', name: 'Autos y motos', query: 'autos carros motos' },
  { slug: 'moda', name: 'Moda y belleza', query: 'moda belleza' },
  { slug: 'ciencia', name: 'Ciencia y espacio', query: 'ciencia espacio universo' },
];

const insertNiche = db.prepare('INSERT OR IGNORE INTO niches (slug, name, query, builtin) VALUES (?, ?, ?, 1)');
db.transaction(() => {
  for (const n of BUILTIN_NICHES) insertNiche.run(n.slug, n.name, n.query);
})();
