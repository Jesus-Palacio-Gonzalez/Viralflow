import fs from 'node:fs';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { loadScript } from './content.js';
import { db } from './db.js';
import { AppError } from './errors.js';
import { probeMedia, runFfmpeg } from './media.js';
import { advanceStage, getProject, stageFolder } from './projects.js';

export const MAX_CLIP_BYTES = 600 * 1024 * 1024;
export const MAX_MUSIC_BYTES = 80 * 1024 * 1024;
const CLIP_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv'];
const MUSIC_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'];

const pad = (n: number): string => String(n).padStart(2, '0');

export interface ClipDTO {
  n: number;
  fileName: string;
  originalName: string;
  durationS: number;
  width: number;
  height: number;
  hasAudio: boolean;
  sizeBytes: number;
  uploadedAt: string;
  thumbUrl: string;
}

export interface MusicDTO {
  fileName: string;
  originalName: string;
  durationS: number;
  sizeBytes: number;
  uploadedAt: string;
}

type UploadRequest = Readable & { headers: Record<string, string | string[] | undefined> };

/** Nombre original que envía el navegador (codificado en la URL): solo el nombre, sin rutas. */
export function cleanName(raw: unknown): string {
  let name = typeof raw === 'string' ? raw : '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // se usa tal cual
  }
  return path.basename(name.replace(/\\/g, '/')).replace(/[^\p{L}\p{N} ._()\-]/gu, '').slice(0, 120) || 'archivo';
}

function safeExt(name: string, allowed: string[], fallback: string): string {
  const ext = path.extname(name).toLowerCase();
  return allowed.includes(ext) ? ext : fallback;
}

/** Guarda el cuerpo de la petición en `dest`, cortando si supera el límite. */
async function receive(req: UploadRequest, dest: string, maxBytes: number): Promise<number> {
  const mb = Math.round(maxBytes / 1024 / 1024);
  const tooBig = new AppError(413, 'FILE_TOO_BIG', `El archivo supera el límite de ${mb} MB.`);
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    req.resume(); // se descarta el cuerpo para poder responder el error
    throw tooBig;
  }

  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) callback(tooBig);
      else callback(null, chunk);
    },
  });
  try {
    await pipeline(req, counter, fs.createWriteStream(dest));
  } catch (err) {
    fs.rmSync(dest, { force: true });
    if (err instanceof AppError) throw err;
    throw new AppError(400, 'UPLOAD_FAILED', 'La subida se interrumpió. Vuelve a intentarlo.');
  }
  if (bytes === 0) {
    fs.rmSync(dest, { force: true });
    throw new AppError(400, 'EMPTY_FILE', 'El archivo está vacío.');
  }
  return bytes;
}

function removeMatching(dir: string, test: (name: string) => boolean, except?: string): void {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    if (file !== except && test(file)) fs.rmSync(path.join(dir, file), { force: true });
  }
}

// ───────────── Clips de escena ─────────────

interface ClipRow {
  n: number;
  file: string;
  original_name: string;
  duration_s: number;
  width: number;
  height: number;
  has_audio: number;
  size_bytes: number;
  uploaded_at: string;
}

const toClip = (projectId: number, row: ClipRow): ClipDTO => ({
  n: row.n,
  fileName: row.file,
  originalName: row.original_name,
  durationS: row.duration_s,
  width: row.width,
  height: row.height,
  hasAudio: row.has_audio === 1,
  sizeBytes: row.size_bytes,
  uploadedAt: row.uploaded_at,
  thumbUrl: `/api/projects/${projectId}/clips/${row.n}/thumb?v=${Date.parse(row.uploaded_at)}`,
});

export function listClips(projectId: number): ClipDTO[] {
  const rows = db.prepare('SELECT * FROM clips WHERE project_id = ? ORDER BY n').all(projectId) as ClipRow[];
  return rows.map((r) => toClip(projectId, r));
}

/** Rutas absolutas de los clips subidos, por número de escena. */
export function clipFiles(projectId: number): Map<number, { file: string; clip: ClipDTO }> {
  const dir = stageFolder(projectId, 'clips');
  return new Map(listClips(projectId).map((c) => [c.n, { file: path.join(dir, c.fileName), clip: c }]));
}

export function clipThumbPath(projectId: number, n: number): string | null {
  const file = path.join(stageFolder(projectId, 'clips'), '.miniaturas', `escena-${pad(n)}.jpg`);
  return fs.existsSync(file) ? file : null;
}

export async function saveClip(projectId: number, n: number, req: UploadRequest, originalName: unknown): Promise<ClipDTO> {
  getProject(projectId);
  const script = loadScript(projectId);
  if (!script) throw new AppError(400, 'NO_SCRIPT', 'Primero genera el guion: los clips se asocian a sus escenas.');
  if (n < 1 || n > script.data.scenes.length) throw new AppError(404, 'NO_SCENE', `La escena ${n} no existe.`);

  const name = cleanName(originalName);
  const dir = stageFolder(projectId, 'clips');
  const part = path.join(dir, `.subida-${n}-${Date.now()}.part`);
  const size = await receive(req, part, MAX_CLIP_BYTES);

  let info;
  try {
    info = await probeMedia(part);
  } catch (err) {
    fs.rmSync(part, { force: true });
    throw err;
  }
  const reject = (message: string): never => {
    fs.rmSync(part, { force: true });
    throw new AppError(400, 'BAD_CLIP', message);
  };
  if (!info.hasVideo) reject('El archivo no es un video que se pueda leer. Usa un .mp4 o .mov descargado de Flow.');
  if (info.durationS < 0.5) reject('El clip dura menos de medio segundo.');
  if (info.durationS > 180) reject('El clip dura más de 3 minutos. Los clips de Flow son de pocos segundos: ¿subiste el archivo correcto?');

  const fileName = `escena-${pad(n)}${safeExt(name, CLIP_EXTENSIONS, '.mp4')}`;
  removeMatching(dir, (f) => new RegExp(`^escena-${pad(n)}\\.`).test(f), undefined);
  fs.renameSync(part, path.join(dir, fileName));

  // La miniatura es un extra: si FFmpeg no la puede sacar, el clip se acepta igual.
  try {
    const thumbs = path.join(dir, '.miniaturas');
    fs.mkdirSync(thumbs, { recursive: true });
    await runFfmpeg(['-ss', String(Math.min(0.5, info.durationS / 2)), '-i', path.join(dir, fileName), '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', path.join(thumbs, `escena-${pad(n)}.jpg`)], { timeoutMs: 30_000 });
  } catch {
    // sin miniatura
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO clips (project_id, n, file, original_name, duration_s, width, height, has_audio, size_bytes, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, n) DO UPDATE SET file = excluded.file, original_name = excluded.original_name,
       duration_s = excluded.duration_s, width = excluded.width, height = excluded.height, has_audio = excluded.has_audio,
       size_bytes = excluded.size_bytes, uploaded_at = excluded.uploaded_at`,
  ).run(projectId, n, fileName, name, info.durationS, info.width, info.height, info.hasAudio ? 1 : 0, size, now);

  const have = new Set(listClips(projectId).map((c) => c.n));
  if (script.data.scenes.every((s) => have.has(s.n))) advanceStage(projectId, 'clips');
  return listClips(projectId).find((c) => c.n === n)!;
}

export function deleteClip(projectId: number, n: number): void {
  getProject(projectId);
  const dir = stageFolder(projectId, 'clips');
  removeMatching(dir, (f) => new RegExp(`^escena-${pad(n)}\\.`).test(f));
  fs.rmSync(path.join(dir, '.miniaturas', `escena-${pad(n)}.jpg`), { force: true });
  db.prepare('DELETE FROM clips WHERE project_id = ? AND n = ?').run(projectId, n);
}

// ───────────── Música ─────────────

interface MusicRow {
  file: string;
  original_name: string;
  duration_s: number;
  size_bytes: number;
  uploaded_at: string;
}

const toMusic = (row: MusicRow): MusicDTO => ({
  fileName: row.file,
  originalName: row.original_name,
  durationS: row.duration_s,
  sizeBytes: row.size_bytes,
  uploadedAt: row.uploaded_at,
});

export function getMusic(projectId: number): MusicDTO | null {
  const row = db.prepare('SELECT file, original_name, duration_s, size_bytes, uploaded_at FROM music WHERE project_id = ?').get(projectId) as
    | MusicRow
    | undefined;
  return row ? toMusic(row) : null;
}

export function musicFile(projectId: number): string | null {
  const music = getMusic(projectId);
  if (!music) return null;
  const file = path.join(stageFolder(projectId, 'audio'), music.fileName);
  return fs.existsSync(file) ? file : null;
}

export async function saveMusic(projectId: number, req: UploadRequest, originalName: unknown): Promise<MusicDTO> {
  getProject(projectId);
  const name = cleanName(originalName);
  const dir = stageFolder(projectId, 'audio');
  const part = path.join(dir, `.musica-${Date.now()}.part`);
  const size = await receive(req, part, MAX_MUSIC_BYTES);

  let info;
  try {
    info = await probeMedia(part);
  } catch (err) {
    fs.rmSync(part, { force: true });
    throw err;
  }
  if (!info.hasAudio || info.durationS < 3) {
    fs.rmSync(part, { force: true });
    throw new AppError(400, 'BAD_MUSIC', 'El archivo no es un audio válido de al menos 3 segundos. Usa un .mp3, .wav o .m4a.');
  }

  const fileName = `musica${safeExt(name, MUSIC_EXTENSIONS, '.mp3')}`;
  removeMatching(dir, (f) => /^musica\./.test(f));
  fs.renameSync(part, path.join(dir, fileName));
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO music (project_id, file, original_name, duration_s, size_bytes, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET file = excluded.file, original_name = excluded.original_name,
       duration_s = excluded.duration_s, size_bytes = excluded.size_bytes, uploaded_at = excluded.uploaded_at`,
  ).run(projectId, fileName, name, info.durationS, size, now);
  return getMusic(projectId)!;
}

export function deleteMusic(projectId: number): void {
  getProject(projectId);
  removeMatching(stageFolder(projectId, 'audio'), (f) => /^musica\./.test(f));
  db.prepare('DELETE FROM music WHERE project_id = ?').run(projectId);
}
