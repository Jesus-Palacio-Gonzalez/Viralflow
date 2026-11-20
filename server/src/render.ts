import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { buildAss, chunkLimits, chunkWords, FONT_FILE, timeChunks, type CaptionOptions, type Cue } from './captions.js';
import { clipFiles, musicFile } from './clips.js';
import { config } from './config.js';
import { loadAnalysis, loadScript } from './content.js';
import { db } from './db.js';
import { AppError } from './errors.js';
import { getFormat } from './formats.js';
import { assertFfmpegReady, probeMedia, runFfmpeg } from './media.js';
import { advanceStage, getProject, projectFolder, stageFolder, type ProjectDTO } from './projects.js';
import { speechText, VOICE_IDS, voiceForScene, type SceneVoice } from './voice.js';

const pad = (n: number): string => String(n).padStart(2, '0');
const round2 = (x: number): number => Math.round(x * 100) / 100;

// ───────────── Opciones ─────────────

export const renderOptionsSchema = z.object({
  voice: z
    .object({
      mode: z.enum(['gemini', 'none']).optional(),
      voiceName: z.enum(VOICE_IDS).optional(),
      pace: z.number().min(0.8).max(1.3).optional(),
    })
    .optional(),
  captions: z
    .object({
      enabled: z.boolean().optional(),
      preset: z.enum(['classic', 'yellow', 'boxed']).optional(),
      position: z.enum(['bottom', 'center', 'top']).optional(),
      uppercase: z.boolean().optional(),
    })
    .optional(),
  music: z.boolean().optional(),
  keepClipAudio: z.boolean().optional(),
  formatIds: z.array(z.string()).min(1).max(10).optional(),
});
export type RenderInput = z.infer<typeof renderOptionsSchema>;

export interface RenderOptions {
  voice: { mode: 'gemini' | 'none'; voiceName: string; pace: number };
  captions: CaptionOptions;
  music: boolean;
  keepClipAudio: boolean;
  formatIds: string[];
}

/** Completa lo que el usuario no eligió; los subtítulos parten del estilo detectado en el video de referencia. */
export function resolveOptions(input: RenderInput, project: ProjectDTO, detected?: Partial<CaptionOptions> | null): RenderOptions {
  const formatIds = input.formatIds ?? project.platforms;
  for (const id of formatIds) {
    if (!project.platforms.includes(id) || !getFormat(id)) {
      throw new AppError(400, 'BAD_FORMAT', `El formato «${id}» no está entre los formatos de este proyecto.`);
    }
  }
  return {
    voice: {
      mode: input.voice?.mode ?? 'gemini',
      voiceName: input.voice?.voiceName ?? 'Kore',
      pace: input.voice?.pace ?? 1,
    },
    captions: {
      enabled: input.captions?.enabled ?? true,
      preset: input.captions?.preset ?? detected?.preset ?? 'classic',
      position: input.captions?.position ?? detected?.position ?? 'bottom',
      uppercase: input.captions?.uppercase ?? detected?.uppercase ?? true,
    },
    music: input.music ?? false,
    keepClipAudio: input.keepClipAudio ?? true,
    formatIds: [...new Set(formatIds)],
  };
}

// ───────────── Plan de cada escena ─────────────

export interface ScenePlan {
  durationS: number;
  voiceTempo: number;
}

const TAIL_S = 0.35;
const MAX_TEMPO = 1.25;
const MAX_FREEZE_S = 2;

/**
 * Cuánto dura la escena en el video final. Con voz, manda la voz (más una pausa final); sin voz,
 * manda el clip. Si la voz obligara a congelar el clip más de unos segundos, se acelera un poco.
 */
export function planScene(input: { plannedS: number; clipS: number; voiceS: number | null; pace: number }): ScenePlan {
  if (input.voiceS == null) {
    return { durationS: round2(Math.max(Math.min(input.clipS, input.plannedS), 1)), voiceTempo: 1 };
  }
  let tempo = input.pace;
  let duration = input.voiceS / tempo + TAIL_S;
  const limit = input.clipS + MAX_FREEZE_S;
  if (duration > limit) {
    tempo = Math.min(MAX_TEMPO, Math.max(tempo, input.voiceS / (limit - TAIL_S)));
    duration = input.voiceS / tempo + TAIL_S;
  }
  return { durationS: round2(Math.max(duration, 1)), voiceTempo: round2(tempo) };
}

// ───────────── Comandos de FFmpeg ─────────────

export interface SegmentInput {
  clip: string;
  clipHasAudio: boolean;
  voice: string | null;
  keepClipAudio: boolean;
  width: number;
  height: number;
  fps: number;
  durationS: number;
  voiceTempo: number;
  /** Nombre (relativo al directorio de trabajo) del archivo .ass, o null si no hay subtítulos. */
  ass: string | null;
  out: string;
}

const AMBIENT_VOLUME = 0.22;

/**
 * Una escena lista para unir: video recortado/ampliado al formato de la plataforma, audio mezclado
 * (voz + sonido ambiente del clip) y subtítulos quemados. Todas las escenas salen con exactamente
 * los mismos parámetros de codificación para poder unirlas después sin recodificar.
 */
export function buildSegmentArgs(i: SegmentInput): string[] {
  const d = i.durationS.toFixed(2);
  const args: string[] = ['-i', i.clip];
  let next = 1;
  const voiceIdx = i.voice ? next++ : -1;
  if (i.voice) args.push('-i', i.voice);
  const ambient = i.keepClipAudio && i.clipHasAudio;
  const silenceIdx = !i.voice && !ambient ? next++ : -1;
  if (silenceIdx >= 0) args.push('-f', 'lavfi', '-t', d, '-i', 'anullsrc=r=48000:cl=stereo');

  const chain = [
    `[0:v]scale=${i.width}:${i.height}:force_original_aspect_ratio=increase`,
    `crop=${i.width}:${i.height}`,
    'setsar=1',
    `fps=${i.fps}`,
    `tpad=stop_mode=clone:stop_duration=${d}`,
    `trim=duration=${d}`,
    'setpts=PTS-STARTPTS',
  ].join(',');
  const video = i.ass ? `${chain}[vb];[vb]subtitles=${i.ass}:fontsdir=fonts[vout]` : `${chain}[vout]`;

  const norm = 'aresample=48000,aformat=channel_layouts=stereo';
  const fit = `apad,atrim=0:${d},asetpts=PTS-STARTPTS`;
  const audio: string[] = [];
  const tempo = i.voiceTempo !== 1 ? `atempo=${i.voiceTempo},` : '';
  if (i.voice && ambient) {
    audio.push(`[${voiceIdx}:a]${tempo}${norm},${fit}[va]`);
    audio.push(`[0:a]volume=${AMBIENT_VOLUME},${norm},${fit}[aa]`);
    audio.push('[va][aa]amix=inputs=2:duration=first:normalize=0[aout]');
  } else if (i.voice) {
    audio.push(`[${voiceIdx}:a]${tempo}${norm},${fit}[aout]`);
  } else if (ambient) {
    audio.push(`[0:a]volume=${AMBIENT_VOLUME},${norm},${fit}[aout]`);
  } else {
    audio.push(`[${silenceIdx}:a]anull[aout]`);
  }

  return [
    ...args,
    '-filter_complex',
    [video, ...audio].join(';'),
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(i.fps),
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    '-t',
    d,
    i.out,
  ];
}

const MUSIC_VOLUME = 0.14;

export function buildMusicArgs(video: string, music: string, durationS: number, out: string): string[] {
  const fadeOutAt = Math.max(durationS - 1.5, 0).toFixed(2);
  return [
    '-i',
    video,
    '-stream_loop',
    '-1',
    '-i',
    music,
    '-filter_complex',
    `[1:a]atrim=0:${durationS.toFixed(2)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${MUSIC_VOLUME},afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutAt}:d=1.5[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]`,
    '-map',
    '0:v',
    '-map',
    '[a]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-shortest',
    '-movflags',
    '+faststart',
    out,
  ];
}

// ───────────── Estado del render ─────────────

export interface RenderOutput {
  formatId: string;
  label: string;
  fileName: string;
  sizeBytes: number;
  durationS: number;
  width: number;
  height: number;
  url: string;
}

export interface RenderState {
  status: 'idle' | 'running' | 'done' | 'error' | 'cancelled';
  step: string;
  progress: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  options: RenderOptions | null;
  outputs: RenderOutput[];
}

const IDLE: RenderState = { status: 'idle', step: '', progress: 0, error: null, startedAt: null, finishedAt: null, options: null, outputs: [] };

interface RenderRow {
  status: RenderState['status'];
  step: string;
  progress: number;
  error: string | null;
  options: string;
  outputs: string;
  started_at: string;
  finished_at: string | null;
}

// Si el servidor se reinició a mitad de un render, quedó una fila «running» que ya no corre.
db.prepare("UPDATE renders SET status = 'error', error = ?, finished_at = ? WHERE status = 'running'").run(
  'El servidor se reinició mientras se generaba el video. Vuelve a generarlo.',
  new Date().toISOString(),
);

const live = new Map<number, { state: RenderState; abort: AbortController }>();
let activeProjectId: number | null = null;

function persist(projectId: number, state: RenderState): void {
  db.prepare(
    `INSERT INTO renders (project_id, status, step, progress, error, options, outputs, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET status = excluded.status, step = excluded.step, progress = excluded.progress,
       error = excluded.error, options = excluded.options, outputs = excluded.outputs,
       started_at = excluded.started_at, finished_at = excluded.finished_at`,
  ).run(
    projectId,
    state.status,
    state.step,
    state.progress,
    state.error,
    JSON.stringify(state.options),
    JSON.stringify(state.outputs),
    state.startedAt ?? new Date().toISOString(),
    state.finishedAt,
  );
}

export function exportDir(projectId: number, formatId: string): string {
  return path.join(stageFolder(projectId, 'exportados'), formatId);
}

export function getRenderState(projectId: number): RenderState {
  const running = live.get(projectId);
  if (running) return { ...running.state, outputs: [...running.state.outputs] };
  const row = db.prepare('SELECT * FROM renders WHERE project_id = ?').get(projectId) as RenderRow | undefined;
  if (!row) return { ...IDLE };
  const outputs = (JSON.parse(row.outputs) as RenderOutput[]).filter((o) => fs.existsSync(path.join(exportDir(projectId, o.formatId), o.fileName)));
  return {
    status: row.status,
    step: row.step,
    progress: row.progress,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    options: JSON.parse(row.options) as RenderOptions | null,
    outputs,
  };
}

export function cancelRender(projectId: number): boolean {
  const entry = live.get(projectId);
  if (!entry) return false;
  entry.abort.abort();
  return true;
}

// ───────────── Lanzamiento ─────────────

export async function startRender(projectId: number, input: RenderInput): Promise<RenderState> {
  const project = getProject(projectId);
  const script = loadScript(projectId);
  if (!script) throw new AppError(400, 'NO_SCRIPT', 'Primero genera el guion y sube los clips de Flow.');

  const clips = clipFiles(projectId);
  const missing = script.data.scenes.filter((s) => !clips.has(s.n) || !fs.existsSync(clips.get(s.n)!.file)).map((s) => s.n);
  if (missing.length) {
    throw new AppError(400, 'MISSING_CLIPS', `Faltan los clips de ${missing.length === 1 ? 'la escena' : 'las escenas'} ${missing.join(', ')}.`);
  }

  const detected = loadAnalysis(projectId)?.data.styleProfile.captions;
  const options = resolveOptions(input, project, detected ? { preset: detected.preset, position: detected.position, uppercase: detected.uppercase } : null);
  if (options.voice.mode === 'gemini' && !config.geminiApiKey) {
    throw new AppError(400, 'NO_GEMINI_KEY', 'Falta GEMINI_API_KEY para generar la voz. Agrégala al archivo .env o elige «Sin voz en off».');
  }
  if (options.music && !musicFile(projectId)) throw new AppError(400, 'NO_MUSIC', 'Activaste la música pero no subiste ninguna pista.');

  await assertFfmpegReady();
  if (activeProjectId !== null) {
    throw new AppError(409, 'RENDER_BUSY', 'Ya se está generando un video. Espera a que termine: el editor usa casi todo el procesador.');
  }
  activeProjectId = projectId;

  const state: RenderState = {
    status: 'running',
    step: 'Preparando',
    progress: 0,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    options,
    outputs: [],
  };
  const abort = new AbortController();
  live.set(projectId, { state, abort });
  persist(projectId, state);

  void run(projectId, options, state, abort)
    .catch((err: unknown) => {
      const cancelled = err instanceof AppError && err.code === 'CANCELLED';
      state.status = cancelled ? 'cancelled' : 'error';
      state.error = cancelled ? 'Cancelaste la generación del video.' : err instanceof AppError ? err.message : `Error inesperado al generar el video: ${(err as Error).message}`;
      if (!(err instanceof AppError)) console.error(err);
    })
    .finally(() => {
      state.finishedAt = new Date().toISOString();
      if (state.status === 'running') state.status = 'error';
      persist(projectId, state);
      live.delete(projectId);
      activeProjectId = null;
      fs.rmSync(path.join(projectFolder(projectId), '.render'), { recursive: true, force: true });
    });

  return { ...state };
}

async function run(projectId: number, options: RenderOptions, state: RenderState, abort: AbortController): Promise<void> {
  const script = loadScript(projectId)!;
  const clips = clipFiles(projectId);
  const scenes = script.data.scenes;
  const folder = projectFolder(projectId);
  const work = path.join(folder, '.render');
  const checkAbort = (): void => {
    if (abort.signal.aborted) throw new AppError(499, 'CANCELLED', 'Cancelado.');
  };

  const voiced = options.voice.mode === 'gemini' ? scenes.filter((s) => speechText(s.voiceover)) : [];
  const total = voiced.length + options.formatIds.length * (scenes.length + 1 + (options.music ? 1 : 0));
  let done = 0;
  const step = (text: string): void => {
    state.step = text;
    state.progress = Math.min(0.99, done / Math.max(total, 1));
  };

  // 1. Voz en off de cada escena (con caché).
  const voices = new Map<number, SceneVoice>();
  if (voiced.length) {
    const audioDir = stageFolder(projectId, 'audio');
    for (const scene of voiced) {
      checkAbort();
      step(`Voz en off: escena ${scene.n} de ${scenes.length}`);
      voices.set(
        scene.n,
        await voiceForScene(audioDir, scene.n, scene.voiceover, options.voice.voiceName, (seconds) => step(`Gemini limita las peticiones: esperando ${seconds} s…`)),
      );
      done++;
    }
  }

  // 2. Un video por formato.
  for (const formatId of options.formatIds) {
    const format = getFormat(formatId)!;
    const dir = path.join(work, formatId);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'fonts'), { recursive: true });
    fs.copyFileSync(path.join(config.fontsDir, FONT_FILE), path.join(dir, 'fonts', FONT_FILE));

    const limits = chunkLimits(format.width, format.height);
    const segments: string[] = [];
    for (const scene of scenes) {
      checkAbort();
      step(`${format.label}: editando escena ${scene.n} de ${scenes.length}`);
      const { file, clip } = clips.get(scene.n)!;
      const voice = voices.get(scene.n) ?? null;
      const plan = planScene({ plannedS: scene.durationS, clipS: clip.durationS, voiceS: voice?.durationS ?? null, pace: options.voice.pace });

      let ass: string | null = null;
      if (options.captions.enabled) {
        const spokenS = voice ? voice.durationS / plan.voiceTempo : Math.max(plan.durationS - TAIL_S, 0.5);
        const text = speechText(scene.voiceover);
        const captions: Cue[] = text ? timeChunks(chunkWords(text, limits.maxWords, limits.maxChars), spokenS) : [];
        const titles: Cue[] = scene.onScreenText.trim() ? [{ start: 0.15, end: Math.min(plan.durationS - 0.1, 3.2), text: scene.onScreenText }] : [];
        if (captions.length || titles.length) {
          ass = `escena-${pad(scene.n)}.ass`;
          fs.writeFileSync(
            path.join(dir, ass),
            buildAss({ width: format.width, height: format.height, safeTopPct: format.safeZone.topPct, safeBottomPct: format.safeZone.bottomPct, options: options.captions, captions, titles }),
          );
        }
      }

      const out = `seg-${pad(scene.n)}.mp4`;
      await runFfmpeg(
        buildSegmentArgs({
          clip: file,
          clipHasAudio: clip.hasAudio,
          voice: voice?.file ?? null,
          keepClipAudio: options.keepClipAudio,
          width: format.width,
          height: format.height,
          fps: format.fps,
          durationS: plan.durationS,
          voiceTempo: plan.voiceTempo,
          ass,
          out,
        }),
        { cwd: dir, signal: abort.signal, timeoutMs: 10 * 60_000 },
      );
      segments.push(out);
      done++;
    }

    checkAbort();
    step(`${format.label}: uniendo las escenas`);
    fs.writeFileSync(path.join(dir, 'lista.txt'), segments.map((s) => `file '${s}'`).join('\n') + '\n');
    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', 'lista.txt', '-c', 'copy', '-movflags', '+faststart', 'unido.mp4'], { cwd: dir, signal: abort.signal, timeoutMs: 5 * 60_000 });
    done++;

    let finalName = 'unido.mp4';
    if (options.music) {
      checkAbort();
      step(`${format.label}: añadiendo la música`);
      const joined = await probeMedia(path.join(dir, 'unido.mp4'));
      await runFfmpeg(buildMusicArgs('unido.mp4', musicFile(projectId)!, joined.durationS, 'con-musica.mp4'), { cwd: dir, signal: abort.signal, timeoutMs: 5 * 60_000 });
      finalName = 'con-musica.mp4';
      done++;
    }

    const outDir = exportDir(projectId, formatId);
    fs.mkdirSync(outDir, { recursive: true });
    const fileName = `${path.basename(folder)}-${formatId}.mp4`;
    fs.copyFileSync(path.join(dir, finalName), path.join(outDir, fileName));
    const info = await probeMedia(path.join(outDir, fileName));
    state.outputs.push({
      formatId,
      label: format.label,
      fileName,
      sizeBytes: fs.statSync(path.join(outDir, fileName)).size,
      durationS: info.durationS,
      width: info.width,
      height: info.height,
      url: `/api/projects/${projectId}/exports/${formatId}`,
    });
  }

  state.status = 'done';
  state.step = 'Listo';
  state.progress = 1;
  advanceStage(projectId, 'exportados');
}
