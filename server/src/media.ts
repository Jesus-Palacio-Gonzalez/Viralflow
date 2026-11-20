import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { AppError } from './errors.js';

let resolved: string | null = null;

/** FFmpeg: variable FFMPEG_PATH, luego el paquete ffmpeg-static (opcional) y por último el del sistema. */
export async function ffmpegPath(): Promise<string> {
  if (resolved) return resolved;
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv) return (resolved = fromEnv);
  try {
    const name = 'ffmpeg-static'; // nombre en variable: el paquete es opcional y TypeScript no debe exigirlo
    const mod: any = await import(name);
    const candidate = mod.default ?? mod;
    if (typeof candidate === 'string' && fs.existsSync(candidate)) return (resolved = candidate);
  } catch {
    // no instalado: se usa el del sistema
  }
  return (resolved = 'ffmpeg');
}

const NO_FFMPEG = new AppError(
  500,
  'NO_FFMPEG',
  'No se encontró FFmpeg. Ejecuta «npm install» de nuevo (instala ffmpeg-static) o instala FFmpeg en tu sistema y define FFMPEG_PATH en el archivo .env.',
);

const tail = (text: string, lines = 6): string => text.trim().split('\n').slice(-lines).join('\n').slice(-900);

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Ejecuta FFmpeg y devuelve su salida de error (donde escribe sus mensajes). Rechaza si el código de salida no es 0. */
export async function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<string> {
  const bin = await ffmpegPath();
  return new Promise((resolve, reject) => {
    let stderr = '';
    const child = spawn(bin, ['-hide_banner', '-nostdin', '-y', ...args], {
      cwd: opts.cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
      signal: opts.signal,
    });
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs) : null;
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (timer) clearTimeout(timer);
      if (err.code === 'ENOENT') reject(NO_FFMPEG);
      else if (err.name === 'AbortError') reject(new AppError(499, 'CANCELLED', 'Cancelado.'));
      else reject(new AppError(500, 'FFMPEG_FAILED', `No se pudo ejecutar FFmpeg: ${err.message}`));
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new AppError(500, 'FFMPEG_FAILED', `FFmpeg terminó con error:\n${tail(stderr)}`));
    });
  });
}

export interface MediaInfo {
  durationS: number;
  width: number;
  height: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
}

const toSeconds = (h: string, m: string, s: string): number => Number(h) * 3600 + Number(m) * 60 + Number(s);

/** Lee duración, dimensiones y pistas con el propio FFmpeg (no hace falta ffprobe). */
export async function probeMedia(file: string): Promise<MediaInfo> {
  const bin = await ffmpegPath();
  const run = (args: string[]): Promise<string> =>
    new Promise((resolve, reject) => {
      let out = '';
      const child = spawn(bin, ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr.on('data', (c: Buffer) => (out += c.toString()));
      child.on('error', (err: NodeJS.ErrnoException) => reject(err.code === 'ENOENT' ? NO_FFMPEG : err));
      // Sin salida, FFmpeg termina con código 1 pero ya imprimió la información: se ignora el código.
      child.on('close', () => resolve(out));
    });

  let text = await run(['-i', file]);
  let duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  let durationS = duration ? toSeconds(duration[1]!, duration[2]!, duration[3]!) : NaN;
  if (!Number.isFinite(durationS)) {
    // Algunos contenedores no declaran duración: se mide decodificando.
    const decoded = await run(['-i', file, '-f', 'null', '-']);
    const times = [...decoded.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
    const last = times.at(-1);
    durationS = last ? toSeconds(last[1]!, last[2]!, last[3]!) : 0;
    text += decoded;
  }

  const video = /Stream #\d+:\d+[^\n]*?: Video:\s*([^\s,]+)[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(text);
  const rotated = /rotation of -?(90|270)(?:\.0+)? degrees/.test(text);
  const width = video ? Number(video[2]) : 0;
  const height = video ? Number(video[3]) : 0;
  return {
    durationS: Math.round(durationS * 100) / 100,
    width: rotated ? height : width,
    height: rotated ? width : height,
    hasVideo: Boolean(video),
    hasAudio: /Stream #\d+:\d+[^\n]*?: Audio:/.test(text),
    videoCodec: video ? video[1]! : null,
  };
}

let checked: Promise<void> | null = null;

/** Verifica una sola vez que este FFmpeg puede codificar H.264/AAC y quemar subtítulos (libass). */
export function assertFfmpegReady(): Promise<void> {
  checked ??= (async () => {
    const bin = await ffmpegPath();
    const read = (args: string[]): Promise<string> =>
      new Promise((resolve, reject) => {
        let out = '';
        const child = spawn(bin, ['-hide_banner', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.on('data', (c: Buffer) => (out += c.toString()));
        child.on('error', (err: NodeJS.ErrnoException) => reject(err.code === 'ENOENT' ? NO_FFMPEG : err));
        child.on('close', () => resolve(out));
      });
    const [encoders, filters] = await Promise.all([read(['-encoders']), read(['-filters'])]);
    const missing = [
      !/\blibx264\b/.test(encoders) && 'libx264 (video H.264)',
      !/\baac\b/.test(encoders) && 'aac (audio)',
      !/\bsubtitles\b/.test(filters) && 'libass (subtítulos)',
    ].filter(Boolean);
    if (missing.length) {
      throw new AppError(
        500,
        'FFMPEG_MISSING_FEATURES',
        `Tu FFmpeg no incluye: ${missing.join(', ')}. Ejecuta «npm install» (instala ffmpeg-static) o usa una compilación completa de FFmpeg y define FFMPEG_PATH.`,
      );
    }
  })().catch((err) => {
    checked = null; // permite reintentar tras corregir la instalación
    throw err;
  });
  return checked;
}
