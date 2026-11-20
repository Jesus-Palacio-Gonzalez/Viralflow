import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { AppError } from './errors.js';
import { getFormat } from './formats.js';
import { slugify } from './util.js';
import { getVideo } from './videos.js';

/** Etapas del flujo de trabajo; cada una tiene su carpeta dentro del proyecto. */
export const STAGES = [
  { id: 'referencia', folder: '00-referencia', label: 'Referencia' },
  { id: 'analisis', folder: '01-analisis', label: 'Análisis' },
  { id: 'guion', folder: '02-guion', label: 'Guion' },
  { id: 'prompts', folder: '03-prompts-flow', label: 'Prompts de Flow' },
  { id: 'clips', folder: '04-clips', label: 'Clips' },
  { id: 'audio', folder: '05-voz-y-musica', label: 'Voz y música' },
  { id: 'subtitulos', folder: '06-subtitulos', label: 'Subtítulos' },
  { id: 'exportados', folder: '07-exportados', label: 'Exportados' },
] as const;

export const STAGE_IDS = STAGES.map((s) => s.id) as [string, ...string[]];

interface ProjectRow {
  id: number;
  slug: string;
  name: string;
  video_id: string | null;
  niche_id: number | null;
  platforms: string;
  stage: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectDTO {
  id: number;
  slug: string;
  name: string;
  videoId: string | null;
  nicheId: number | null;
  platforms: string[];
  stage: string;
  folder: string;
  createdAt: string;
  updatedAt: string;
  folderExists: boolean;
  reference: { title: string; thumbnail: string; url: string; channelTitle: string; source: 'youtube' | 'demo' } | null;
}

export interface TreeNode {
  name: string;
  type: 'dir' | 'file';
  size?: number;
  children?: TreeNode[];
}

/** Resuelve una ruta y verifica que quede dentro de `base`. */
function resolveInside(base: string, ...parts: string[]): string {
  const resolved = path.resolve(base, ...parts);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new AppError(400, 'BAD_PATH', 'Ruta fuera del espacio de trabajo.');
  }
  return resolved;
}

function toDTO(row: ProjectRow): ProjectDTO {
  const folder = resolveInside(config.workspaceDir, row.slug);
  const video = row.video_id ? getVideo(row.video_id) : null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    videoId: row.video_id,
    nicheId: row.niche_id,
    platforms: JSON.parse(row.platforms) as string[],
    stage: row.stage,
    folder,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    folderExists: fs.existsSync(folder),
    reference: video
      ? { title: video.title, thumbnail: video.thumbnail, url: video.url, channelTitle: video.channelTitle, source: video.source }
      : null,
  };
}

function readmeFor(name: string, platforms: string[], reference: { title: string; url: string } | null): string {
  const targets = platforms.map((id) => getFormat(id)?.label ?? id).join(', ');
  return `# ${name}

- **Plataformas destino:** ${targets}
- **Video de referencia:** ${reference ? `[${reference.title}](${reference.url})` : 'sin referencia'}

## Flujo de trabajo

${STAGES.map((s) => `- \`${s.folder}/\` — ${s.label}`).join('\n')}

Dentro de \`07-exportados/\` hay una carpeta por plataforma, con un \`format.json\` que describe
resolución, relación de aspecto y duración recomendada.

## Notas

- Adapta la estructura del video de referencia (gancho, ritmo, formato) con contenido propio; no lo copies tal cual.
- Google Flow genera clips cortos: divide el guion en escenas de pocos segundos y guarda cada clip en \`04-clips/\`.
`;
}

export function createProject(input: {
  name: string;
  videoId?: string;
  nicheId?: number;
  platforms: string[];
}): ProjectDTO {
  for (const id of input.platforms) {
    if (!getFormat(id)) throw new AppError(400, 'BAD_PLATFORM', `Formato desconocido: ${id}`);
  }
  const reference = input.videoId ? getVideo(input.videoId) : null;
  if (input.videoId && !reference) throw new AppError(404, 'NOT_FOUND', 'No se encontró el video de referencia.');

  fs.mkdirSync(config.workspaceDir, { recursive: true });
  const base = slugify(input.name);
  let slug = base;
  for (let n = 2; fs.existsSync(path.join(config.workspaceDir, slug)) || projectSlugTaken(slug); n++) {
    slug = `${base}-${n}`;
  }
  const folder = resolveInside(config.workspaceDir, slug);

  for (const stage of STAGES) fs.mkdirSync(path.join(folder, stage.folder), { recursive: true });
  for (const id of input.platforms) {
    const dir = path.join(folder, '07-exportados', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'format.json'), JSON.stringify(getFormat(id), null, 2));
  }
  if (reference) {
    fs.writeFileSync(path.join(folder, '00-referencia', 'video.json'), JSON.stringify(reference, null, 2));
  }
  fs.writeFileSync(
    path.join(folder, 'project.json'),
    JSON.stringify(
      { name: input.name, platforms: input.platforms, videoId: input.videoId ?? null, createdAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(folder, 'README.md'),
    readmeFor(input.name, input.platforms, reference ? { title: reference.title, url: reference.url } : null),
  );

  const now = new Date().toISOString();
  const id = Number(
    db
      .prepare(
        'INSERT INTO projects (slug, name, video_id, niche_id, platforms, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(slug, input.name, input.videoId ?? null, input.nicheId ?? null, JSON.stringify(input.platforms), 'referencia', now, now)
      .lastInsertRowid,
  );
  return getProject(id);
}

function projectSlugTaken(slug: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM projects WHERE slug = ?').get(slug));
}

export function listProjects(): ProjectDTO[] {
  const rows = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC, id DESC').all() as ProjectRow[];
  return rows.map(toDTO);
}

function rowOrThrow(id: number): ProjectRow {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  if (!row) throw new AppError(404, 'NOT_FOUND', 'No se encontró el proyecto.');
  return row;
}

export function getProject(id: number): ProjectDTO {
  return toDTO(rowOrThrow(id));
}

export function updateProject(id: number, patch: { stage?: string; name?: string }): ProjectDTO {
  const row = rowOrThrow(id);
  db.prepare('UPDATE projects SET stage = ?, name = ?, updated_at = ? WHERE id = ?').run(
    patch.stage ?? row.stage,
    patch.name ?? row.name,
    new Date().toISOString(),
    id,
  );
  return getProject(id);
}

/** Carpeta del proyecto en disco (siempre dentro del espacio de trabajo). */
export function projectFolder(id: number): string {
  return resolveInside(config.workspaceDir, rowOrThrow(id).slug);
}

/** Carpeta de una etapa; se crea si no existe (por ejemplo, si alguien la borró a mano). */
export function stageFolder(id: number, stageId: (typeof STAGES)[number]['id']): string {
  const stage = STAGES.find((s) => s.id === stageId)!;
  const dir = path.join(projectFolder(id), stage.folder);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Avanza la etapa solo hacia adelante: regenerar un guion no devuelve el proyecto atrás. */
export function advanceStage(id: number, stageId: (typeof STAGES)[number]['id']): void {
  const row = rowOrThrow(id);
  const current = STAGES.findIndex((s) => s.id === row.stage);
  const target = STAGES.findIndex((s) => s.id === stageId);
  db.prepare('UPDATE projects SET stage = ?, updated_at = ? WHERE id = ?').run(
    target > current ? stageId : row.stage,
    new Date().toISOString(),
    id,
  );
}

export function deleteProject(id: number, deleteFiles: boolean): void {
  const row = rowOrThrow(id);
  if (deleteFiles) {
    const folder = resolveInside(config.workspaceDir, row.slug);
    if (folder === config.workspaceDir) throw new AppError(400, 'BAD_PATH', 'Ruta no permitida.');
    fs.rmSync(folder, { recursive: true, force: true });
  }
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

function walk(dir: string, depth: number): TreeNode[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  return entries.map((entry): TreeNode => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return { name: entry.name, type: 'dir', children: depth > 0 ? walk(full, depth - 1) : [] };
    }
    return { name: entry.name, type: 'file', size: fs.statSync(full).size };
  });
}

export function projectTree(id: number): TreeNode[] {
  const row = rowOrThrow(id);
  const folder = resolveInside(config.workspaceDir, row.slug);
  return fs.existsSync(folder) ? walk(folder, 2) : [];
}
