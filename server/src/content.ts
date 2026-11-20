import fs from 'node:fs';
import path from 'node:path';
import {
  analysisSchema,
  MAX_SCENE_SECONDS,
  MIN_SCENE_SECONDS,
  scriptSchema,
  type Analysis,
  type Scene,
  type ScriptData,
  type ScriptParams,
  type ScriptPatch,
} from './content-schemas.js';
import { db } from './db.js';
import { AppError } from './errors.js';
import { getFormat } from './formats.js';
import { generateJson, type Part } from './gemini.js';
import { buildAnalysisPrompt, buildScriptPrompt } from './prompts.js';
import { advanceStage, getProject, stageFolder } from './projects.js';
import { getVideo } from './videos.js';

export type AnalysisMode = 'video' | 'metadata';
type Aspect = '9:16' | '16:9';

export interface StoredScene extends Scene {
  n: number;
}
export interface StoredScript extends Omit<ScriptData, 'scenes'> {
  scenes: StoredScene[];
}
export interface StoredParams extends ScriptParams {
  aspect: Aspect;
  platformLabel: string | null;
}

export interface AnalysisDTO {
  mode: AnalysisMode;
  model: string;
  createdAt: string;
  data: Analysis;
}
export interface ScriptDTO {
  params: StoredParams;
  model: string;
  createdAt: string;
  updatedAt: string;
  data: Omit<StoredScript, 'scenes'> & { scenes: Array<StoredScene & { flowPrompt: string }> };
  totalS: number;
}

/** Evita lanzar dos llamadas de IA a la vez sobre el mismo proyecto (doble clic, dos pestañas). */
const busy = new Set<number>();
async function exclusive<T>(projectId: number, work: () => Promise<T>): Promise<T> {
  if (busy.has(projectId)) throw new AppError(409, 'AI_BUSY', 'Ya hay una generación en curso para este proyecto. Espera a que termine.');
  busy.add(projectId);
  try {
    return await work();
  } finally {
    busy.delete(projectId);
  }
}

// ───────────── Prompt final para Flow ─────────────

/**
 * Cada clip de Flow se genera por separado: el prompt final junta la escena con el estilo común y
 * deja claro el formato. La voz, la música y los textos se añaden después, así que se piden fuera.
 */
export function composeFlowPrompt(styleBible: string, scene: Scene, opts: { aspect: Aspect; promptLanguage: 'en' | 'es' }): string {
  const es = opts.promptLanguage === 'es';
  const orientation = opts.aspect === '16:9' ? 'horizontal 16:9' : 'vertical 9:16';
  return [
    scene.visualPrompt.trim(),
    '',
    styleBible.trim() ? `${es ? 'Estilo visual' : 'Visual style'}: ${styleBible.trim()}` : '',
    scene.audioPrompt.trim() ? `${es ? 'Sonido ambiente' : 'Ambient sound'}: ${scene.audioPrompt.trim()}` : '',
    es
      ? `Formato: ${orientation}, ${scene.durationS} segundos. Sin voz, sin música, sin texto en pantalla, sin logos.`
      : `Format: ${orientation}, ${scene.durationS} seconds. No speech, no music, no on-screen text, no logos.`,
  ]
    .filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== ''))
    .join('\n');
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function normalizeScript(data: ScriptData): StoredScript {
  return {
    ...data,
    title: data.title.trim(),
    hashtags: [...new Set(data.hashtags.map((h) => h.replace(/^#+/, '').replace(/\s+/g, '').trim()).filter(Boolean))].slice(0, 12),
    scenes: data.scenes.slice(0, 14).map((s, i) => ({
      n: i + 1,
      durationS: clamp(Math.round(s.durationS || 5), MIN_SCENE_SECONDS, MAX_SCENE_SECONDS),
      voiceover: s.voiceover.trim(),
      onScreenText: s.onScreenText.trim(),
      visualPrompt: s.visualPrompt.trim(),
      audioPrompt: s.audioPrompt.trim(),
    })),
  };
}

// ───────────── Lectura y guardado ─────────────

interface AnalysisRow {
  mode: AnalysisMode;
  model: string;
  data: string;
  created_at: string;
}
interface ScriptRow {
  params: string;
  model: string;
  data: string;
  created_at: string;
  updated_at: string;
}

export function loadAnalysis(projectId: number): AnalysisDTO | null {
  const row = db.prepare('SELECT mode, model, data, created_at FROM analyses WHERE project_id = ?').get(projectId) as AnalysisRow | undefined;
  return row ? { mode: row.mode, model: row.model, createdAt: row.created_at, data: analysisSchema.parse(JSON.parse(row.data)) } : null;
}

function toScriptDTO(row: ScriptRow): ScriptDTO {
  const params = JSON.parse(row.params) as StoredParams;
  const parsed = JSON.parse(row.data) as StoredScript;
  const data: StoredScript = { ...parsed, alternativeHooks: parsed.alternativeHooks ?? [] };
  return {
    params,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    data: {
      ...data,
      scenes: data.scenes.map((s) => ({ ...s, flowPrompt: composeFlowPrompt(data.styleBible, s, params) })),
    },
    totalS: data.scenes.reduce((sum, s) => sum + s.durationS, 0),
  };
}

export function loadScript(projectId: number): ScriptDTO | null {
  const row = db.prepare('SELECT params, model, data, created_at, updated_at FROM scripts WHERE project_id = ?').get(projectId) as ScriptRow | undefined;
  return row ? toScriptDTO(row) : null;
}

export function getContent(projectId: number): { analysis: AnalysisDTO | null; script: ScriptDTO | null } {
  getProject(projectId); // 404 si no existe
  return { analysis: loadAnalysis(projectId), script: loadScript(projectId) };
}

// ───────────── Archivos en las carpetas del proyecto ─────────────

const write = (dir: string, name: string, content: string): void => fs.writeFileSync(path.join(dir, name), content, 'utf8');
const pad = (n: number): string => String(n).padStart(2, '0');

function analysisMarkdown(a: AnalysisDTO): string {
  const d = a.data;
  const lines = [
    `# Análisis del video de referencia`,
    '',
    `_Generado con ${a.model} · ${a.mode === 'video' ? 'viendo el video' : 'solo con título y descripción'}_`,
    '',
    `## Resumen`,
    d.summary,
    '',
    `## Gancho`,
    `${d.hook.text}${d.hook.technique ? ` — *${d.hook.technique}*` : ''}`,
    '',
    ...(d.hookDetail.template || d.hookDetail.visual
      ? [
          `### Anatomía del gancho`,
          d.hookDetail.visual ? `- **Imagen:** ${d.hookDetail.visual}` : '',
          d.hookDetail.spoken ? `- **Dicho:** ${d.hookDetail.spoken}` : '',
          d.hookDetail.onScreenText ? `- **Texto:** ${d.hookDetail.onScreenText}` : '',
          d.hookDetail.patternInterrupt ? `- **Rompe el scroll:** ${d.hookDetail.patternInterrupt}` : '',
          d.hookDetail.whyItStops ? `- **Por qué detiene:** ${d.hookDetail.whyItStops}` : '',
          d.hookDetail.template ? `- **Plantilla:** ${d.hookDetail.template}` : '',
          '',
        ]
      : []),
    `## Estructura`,
    ...d.structure.map((b) => `- **${b.startS}–${b.endS} s · ${b.label}:** ${b.description}`),
    '',
    `## Ritmo`,
    d.pacing,
    '',
    `## Estilo visual`,
    d.visualStyle.description,
    d.visualStyle.shotTypes.length ? `\nPlanos: ${d.visualStyle.shotTypes.join(', ')}` : '',
    d.visualStyle.palette.length ? `\nPaleta: ${d.visualStyle.palette.join(', ')}` : '',
    d.visualStyle.textOnScreen ? `\nTextos en pantalla: ${d.visualStyle.textOnScreen}` : '',
    '',
    `## Audio`,
    `- Voz: ${d.audio.voice}`,
    `- Música: ${d.audio.music}`,
    `- Efectos: ${d.audio.soundEffects}`,
    '',
    `## Por qué funciona`,
    ...d.whyItWorks.map((w) => `- ${w}`),
    '',
    `## Fórmula`,
    d.formula,
  ];
  if (d.transcript) lines.push('', `## Transcripción`, d.transcript);
  return lines.join('\n') + '\n';
}

function scriptMarkdown(s: ScriptDTO): string {
  const d = s.data;
  return (
    [
      `# ${d.title}`,
      '',
      d.concept,
      '',
      `- **Duración:** ${s.totalS} s · **Formato:** ${s.params.aspect}${s.params.platformLabel ? ` · ${s.params.platformLabel}` : ''}`,
      `- **Gancho:** ${d.hook}`,
      `- **Música sugerida:** ${d.musicSuggestion}`,
      '',
      `## Escenas`,
      ...d.scenes.flatMap((sc) => [
        '',
        `### Escena ${sc.n} · ${sc.durationS} s`,
        sc.voiceover ? `**Voz en off:** ${sc.voiceover}` : '_Sin voz en off_',
        sc.onScreenText ? `**Texto en pantalla:** ${sc.onScreenText}` : '',
      ]),
      '',
      `## Para publicar`,
      d.caption,
      d.hashtags.map((h) => `#${h}`).join(' '),
    ]
      .filter((line, i, all) => line !== '' || all[i - 1] !== '')
      .join('\n') + '\n'
  );
}

function promptsMarkdown(s: ScriptDTO): string {
  return (
    [
      `# Prompts para Google Flow — ${s.data.title}`,
      '',
      `Genera un clip por escena (${s.params.aspect}) y guárdalos en \`04-clips/\` con el nombre \`escena-01.mp4\`, \`escena-02.mp4\`…`,
      '',
      ...s.data.scenes.flatMap((sc) => [`## Escena ${sc.n} · ${sc.durationS} s`, '', '```', sc.flowPrompt, '```', '']),
    ].join('\n')
  );
}

export function writeAnalysisFiles(projectId: number, a: AnalysisDTO): void {
  const dir = stageFolder(projectId, 'analisis');
  write(dir, 'analisis.json', JSON.stringify(a, null, 2));
  write(dir, 'analisis.md', analysisMarkdown(a));
}

export function writeScriptFiles(projectId: number, s: ScriptDTO): void {
  const scriptDir = stageFolder(projectId, 'guion');
  write(scriptDir, 'guion.json', JSON.stringify(s, null, 2));
  write(scriptDir, 'guion.md', scriptMarkdown(s));

  const promptsDir = stageFolder(projectId, 'prompts');
  // Si el nuevo guion tiene menos escenas, no deben quedar archivos de escenas viejas.
  for (const file of fs.readdirSync(promptsDir)) {
    if (/^escena-\d+\.txt$/.test(file)) fs.rmSync(path.join(promptsDir, file));
  }
  for (const sc of s.data.scenes) write(promptsDir, `escena-${pad(sc.n)}.txt`, sc.flowPrompt + '\n');
  write(promptsDir, 'prompts.md', promptsMarkdown(s));

  const voiceDir = stageFolder(projectId, 'audio');
  write(voiceDir, 'voz-en-off.txt', s.data.scenes.map((sc) => sc.voiceover).filter(Boolean).join('\n\n') + '\n');
}

// ───────────── Análisis ─────────────

export function analyzeProject(projectId: number, mode: AnalysisMode): Promise<AnalysisDTO> {
  const project = getProject(projectId);
  return exclusive(projectId, async () => {
    const video = project.videoId ? getVideo(project.videoId) : null;
    if (!video) throw new AppError(400, 'NO_REFERENCE', 'Este proyecto no tiene video de referencia que analizar.');
    if (mode === 'video' && video.source === 'demo') {
      throw new AppError(400, 'DEMO_VIDEO', 'Los videos de demo no existen en YouTube, así que Gemini no puede verlos. Usa el modo «Solo título y descripción».');
    }

    const parts: Part[] = [{ text: buildAnalysisPrompt(video, mode === 'video') }];
    if (mode === 'video') parts.push({ file_data: { file_uri: video.url } });

    let result;
    try {
      result = await generateJson({ parts, temperature: 0.4, timeoutMs: mode === 'video' ? 180_000 : 60_000 }, analysisSchema);
    } catch (err) {
      if (mode === 'video' && err instanceof AppError && err.code === 'GEMINI_BAD_REQUEST') {
        throw new AppError(err.status, err.code, `${err.message} Si el video es privado, no listado o tiene restricciones, prueba el modo «Solo título y descripción».`);
      }
      throw err;
    }

    const data: Analysis = { ...result.data, transcript: mode === 'video' ? result.data.transcript : null };
    const dto: AnalysisDTO = { mode, model: result.model, createdAt: new Date().toISOString(), data };

    db.prepare(
      `INSERT INTO analyses (project_id, mode, model, data, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET mode = excluded.mode, model = excluded.model, data = excluded.data, created_at = excluded.created_at`,
    ).run(projectId, dto.mode, dto.model, JSON.stringify(dto.data), dto.createdAt);

    writeAnalysisFiles(projectId, dto);
    advanceStage(projectId, 'analisis');
    return dto;
  });
}

// ───────────── Guion y prompts ─────────────

export function generateProjectScript(projectId: number, params: ScriptParams): Promise<ScriptDTO> {
  const project = getProject(projectId);
  return exclusive(projectId, async () => {
    const format = getFormat(params.formatId ?? project.platforms[0] ?? '');
    // Flow genera en 16:9 y 9:16; los formatos 4:5 y 1:1 se producen en vertical y se recortan al montar.
    const aspect: Aspect = format?.aspect === '16:9' ? '16:9' : '9:16';
    const stored: StoredParams = { ...params, aspect, platformLabel: format?.label ?? null };

    const analysis = loadAnalysis(projectId);
    const prompt = buildScriptPrompt(analysis?.data ?? null, params, {
      aspect,
      platformLabel: stored.platformLabel,
      referenceTitle: project.reference?.title ?? null,
    });
    const { data, model } = await generateJson({ parts: [{ text: prompt }], temperature: 0.9, timeoutMs: 120_000 }, scriptSchema);

    const script = normalizeScript(data);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO scripts (project_id, params, model, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET params = excluded.params, model = excluded.model, data = excluded.data,
         created_at = excluded.created_at, updated_at = excluded.updated_at`,
    ).run(projectId, JSON.stringify(stored), model, JSON.stringify(script), now, now);

    const dto = loadScript(projectId)!;
    writeScriptFiles(projectId, dto);
    advanceStage(projectId, 'prompts');
    return dto;
  });
}

export function updateScript(projectId: number, patch: ScriptPatch): ScriptDTO {
  getProject(projectId);
  const row = db.prepare('SELECT params, model, data, created_at, updated_at FROM scripts WHERE project_id = ?').get(projectId) as ScriptRow | undefined;
  if (!row) throw new AppError(404, 'NO_SCRIPT', 'Este proyecto todavía no tiene guion.');

  const script = JSON.parse(row.data) as StoredScript;
  if (patch.title !== undefined) script.title = patch.title;
  if (patch.styleBible !== undefined) script.styleBible = patch.styleBible.trim();
  if (patch.caption !== undefined) script.caption = patch.caption.trim();
  if (patch.hashtags !== undefined) {
    script.hashtags = [...new Set(patch.hashtags.map((h) => h.replace(/^#+/, '').replace(/\s+/g, '').trim()).filter(Boolean))];
  }
  for (const edit of patch.scenes ?? []) {
    const scene = script.scenes.find((s) => s.n === edit.n);
    if (!scene) throw new AppError(404, 'NO_SCENE', `La escena ${edit.n} no existe.`);
    if (edit.voiceover !== undefined) scene.voiceover = edit.voiceover.trim();
    if (edit.onScreenText !== undefined) scene.onScreenText = edit.onScreenText.trim();
    if (edit.visualPrompt !== undefined) scene.visualPrompt = edit.visualPrompt;
    if (edit.audioPrompt !== undefined) scene.audioPrompt = edit.audioPrompt.trim();
    if (edit.durationS !== undefined) scene.durationS = Math.round(edit.durationS);
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE scripts SET data = ?, updated_at = ? WHERE project_id = ?').run(JSON.stringify(script), now, projectId);
  const dto = loadScript(projectId)!;
  writeScriptFiles(projectId, dto);
  return dto;
}
