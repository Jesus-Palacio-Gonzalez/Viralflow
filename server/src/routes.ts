import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { computeNicheStats, computeTrendingTerms } from './analytics.js';
import { CATEGORIES, DEFAULT_TRENDING_CATEGORIES } from './categories.js';
import { analyzeProject, generateProjectScript, getContent, updateScript } from './content.js';
import { scriptParamsSchema, scriptPatchSchema } from './content-schemas.js';
import { config } from './config.js';
import { db } from './db.js';
import { clearDemo, demoCount, seedDemo } from './demo.js';
import { AppError } from './errors.js';
import { FORMAT_IDS, FORMATS } from './formats.js';
import { deleteClip, deleteMusic, clipThumbPath, getMusic, listClips, saveClip, saveMusic } from './clips.js';
import { cancelRender, exportDir, getRenderState, renderOptionsSchema, startRender } from './render.js';
import { SAMPLE_TEXT, VOICE_IDS, VOICES } from './voice.js';
import { pingGemini, synthesizeSpeech } from './gemini.js';
import path from 'node:path';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  projectTree,
  STAGE_IDS,
  STAGES,
  updateProject,
} from './projects.js';
import { quotaStatus } from './quota.js';
import { estimateCost, isScanRunning, runScan, scanSchema } from './scanner.js';
import type { NicheRow } from './types.js';
import { slugify } from './util.js';
import { getVideo, loadVideos, queryVideos } from './videos.js';

export const api = Router();

type Handler = (req: Request, res: Response) => unknown;
const h =
  (fn: Handler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch(next);
  };

const idParam = (req: Request): number => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'BAD_ID', 'Identificador inválido.');
  return id;
};

function allNiches(): NicheRow[] {
  const rows = db.prepare('SELECT id, slug, name, query, builtin FROM niches ORDER BY id').all() as Array<
    Omit<NicheRow, 'builtin'> & { builtin: number }
  >;
  return rows.map((r) => ({ ...r, builtin: r.builtin === 1 }));
}

// ───────────── Estado y catálogos ─────────────

api.get(
  '/status',
  h((_req, res) => {
    const counts = db
      .prepare("SELECT COUNT(*) AS total, SUM(source = 'demo') AS demo FROM videos")
      .get() as { total: number; demo: number | null };
    res.json({
      apiKeyConfigured: Boolean(config.youtubeApiKey),
      aiConfigured: Boolean(config.geminiApiKey),
      aiModel: config.geminiModel,
      quota: quotaStatus(),
      workspaceDir: config.workspaceDir,
      totalVideos: counts.total,
      demoVideos: counts.demo ?? 0,
      scanRunning: isScanRunning(),
    });
  }),
);

api.get(
  '/formats',
  h((_req, res) => {
    res.json(FORMATS);
  }),
);

api.get(
  '/catalog',
  h((_req, res) => {
    res.json({
      categories: Object.entries(CATEGORIES).map(([id, name]) => ({ id, name })),
      defaultTrendingCategories: DEFAULT_TRENDING_CATEGORIES,
      stages: STAGES,
    });
  }),
);

// ───────────── Nichos ─────────────

const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });

api.get(
  '/niches',
  h((req, res) => {
    const { days } = daysQuery.parse(req.query);
    const videos = loadVideos({ days, duration: 'any' });
    res.json(computeNicheStats(videos, allNiches()));
  }),
);

api.get(
  '/niches/terms',
  h((req, res) => {
    const { days } = daysQuery.extend({ days: z.coerce.number().int().min(1).max(90).default(7) }).parse(req.query);
    res.json(computeTrendingTerms(loadVideos({ days, duration: 'any' })));
  }),
);

api.post(
  '/niches',
  h((req, res) => {
    const body = z
      .object({ name: z.string().trim().min(2).max(60), query: z.string().trim().min(2).max(100) })
      .parse(req.body);
    const base = slugify(body.name, 30);
    let slug = base;
    for (let n = 2; db.prepare('SELECT 1 FROM niches WHERE slug = ?').get(slug); n++) slug = `${base}-${n}`;
    const id = Number(
      db.prepare('INSERT INTO niches (slug, name, query, builtin) VALUES (?, ?, ?, 0)').run(slug, body.name, body.query)
        .lastInsertRowid,
    );
    res.status(201).json(allNiches().find((n) => n.id === id));
  }),
);

api.delete(
  '/niches/:id',
  h((req, res) => {
    const id = idParam(req);
    const row = db.prepare('SELECT builtin FROM niches WHERE id = ?').get(id) as { builtin: number } | undefined;
    if (!row) throw new AppError(404, 'NOT_FOUND', 'No se encontró el nicho.');
    if (row.builtin === 1) throw new AppError(400, 'BUILTIN', 'Los nichos incluidos no se pueden borrar.');
    db.prepare('DELETE FROM niches WHERE id = ?').run(id);
    res.status(204).end();
  }),
);

// ───────────── Escaneos ─────────────

api.post(
  '/scans/estimate',
  h((req, res) => {
    const params = scanSchema.parse(req.body);
    res.json({ units: estimateCost(params), remaining: quotaStatus().remaining });
  }),
);

api.post(
  '/scans',
  h(async (req, res) => {
    const params = scanSchema.parse(req.body);
    res.status(201).json(await runScan(params));
  }),
);

api.get(
  '/scans',
  h((_req, res) => {
    res.json(db.prepare('SELECT id, mode, status, found, units_used, message, started_at, finished_at FROM scans ORDER BY id DESC LIMIT 15').all());
  }),
);

// ───────────── Videos ─────────────

const videosQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
  nicheId: z.coerce.number().int().positive().optional(),
  duration: z.enum(['short', 'any']).default('short'),
  minScore: z.coerce.number().min(0).max(100).default(0),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['score', 'vph', 'views', 'ratio', 'recent', 'growth']).default('score'),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  offset: z.coerce.number().int().min(0).default(0),
});

api.get(
  '/videos',
  h((req, res) => {
    res.json(queryVideos(videosQuery.parse(req.query)));
  }),
);

api.get(
  '/videos/:id',
  h((req, res) => {
    const video = getVideo(String(req.params.id));
    if (!video) throw new AppError(404, 'NOT_FOUND', 'No se encontró el video.');
    res.json(video);
  }),
);

// ───────────── Datos de demostración ─────────────

api.post(
  '/demo/seed',
  h((_req, res) => {
    res.status(201).json({ videos: seedDemo() });
  }),
);

api.delete(
  '/demo',
  h((_req, res) => {
    clearDemo();
    res.json({ remaining: demoCount() });
  }),
);

// ───────────── Proyectos ─────────────

const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(80),
  videoId: z.string().trim().min(1).max(40).optional(),
  nicheId: z.number().int().positive().optional(),
  platforms: z.array(z.enum(FORMAT_IDS as [string, ...string[]])).min(1).max(FORMAT_IDS.length),
});

api.get(
  '/projects',
  h((_req, res) => {
    res.json(listProjects());
  }),
);

api.post(
  '/projects',
  h((req, res) => {
    res.status(201).json(createProject(createProjectSchema.parse(req.body)));
  }),
);

api.get(
  '/projects/:id',
  h((req, res) => {
    const id = idParam(req);
    res.json({ project: getProject(id), tree: projectTree(id) });
  }),
);

api.patch(
  '/projects/:id',
  h((req, res) => {
    const patch = z
      .object({ stage: z.enum(STAGE_IDS).optional(), name: z.string().trim().min(2).max(80).optional() })
      .parse(req.body);
    res.json(updateProject(idParam(req), patch));
  }),
);

api.delete(
  '/projects/:id',
  h((req, res) => {
    const { deleteFiles } = z.object({ deleteFiles: z.enum(['1', '0']).default('0') }).parse(req.query);
    deleteProject(idParam(req), deleteFiles === '1');
    res.status(204).end();
  }),
);

// ───────────── IA: análisis, guion y prompts para Flow ─────────────

api.post(
  '/ai/test',
  h(async (_req, res) => {
    res.json(await pingGemini());
  }),
);

api.get(
  '/projects/:id/content',
  h((req, res) => {
    const id = idParam(req);
    res.json({ ...getContent(id), clips: listClips(id), music: getMusic(id), render: getRenderState(id), voices: VOICES });
  }),
);

const sceneParam = (req: Request): number => {
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 1) throw new AppError(400, 'BAD_SCENE', 'Número de escena inválido.');
  return n;
};

api.put(
  '/projects/:id/clips/:n',
  h(async (req, res) => {
    res.json(await saveClip(idParam(req), sceneParam(req), req, req.headers['x-filename']));
  }),
);

api.delete(
  '/projects/:id/clips/:n',
  h((req, res) => {
    deleteClip(idParam(req), sceneParam(req));
    res.status(204).end();
  }),
);

api.get(
  '/projects/:id/clips/:n/thumb',
  h((req, res) => {
    const file = clipThumbPath(idParam(req), sceneParam(req));
    if (!file) throw new AppError(404, 'NO_THUMB', 'Sin miniatura.');
    res.sendFile(file, { dotfiles: 'allow' });
  }),
);

api.put(
  '/projects/:id/music',
  h(async (req, res) => {
    res.json(await saveMusic(idParam(req), req, req.headers['x-filename']));
  }),
);

api.delete(
  '/projects/:id/music',
  h((req, res) => {
    deleteMusic(idParam(req));
    res.status(204).end();
  }),
);

api.post(
  '/projects/:id/render',
  h(async (req, res) => {
    res.status(202).json(await startRender(idParam(req), renderOptionsSchema.parse(req.body ?? {})));
  }),
);

api.get(
  '/projects/:id/render',
  h((req, res) => {
    res.json(getRenderState(idParam(req)));
  }),
);

api.post(
  '/projects/:id/render/cancel',
  h((req, res) => {
    res.json({ cancelled: cancelRender(idParam(req)) });
  }),
);

api.get(
  '/projects/:id/exports/:formatId',
  h((req, res) => {
    const id = idParam(req);
    const out = getRenderState(id).outputs.find((o) => o.formatId === req.params.formatId);
    if (!out) throw new AppError(404, 'NO_EXPORT', 'Ese video todavía no se ha generado.');
    const root = exportDir(id, out.formatId);
    if (req.query.download === '1') res.download(path.join(root, out.fileName), out.fileName);
    else res.sendFile(out.fileName, { root });
  }),
);

api.post(
  '/ai/voice-sample',
  h(async (req, res) => {
    const { voiceName } = z.object({ voiceName: z.enum(VOICE_IDS) }).parse(req.body ?? {});
    if (!config.geminiApiKey) throw new AppError(400, 'NO_GEMINI_KEY', 'Falta GEMINI_API_KEY en el archivo .env.');
    res.type('audio/wav').send(await synthesizeSpeech(SAMPLE_TEXT, voiceName));
  }),
);

api.post(
  '/projects/:id/analyze',
  h(async (req, res) => {
    const { mode } = z.object({ mode: z.enum(['video', 'metadata']).default('video') }).parse(req.body ?? {});
    res.json(await analyzeProject(idParam(req), mode));
  }),
);

api.post(
  '/projects/:id/script',
  h(async (req, res) => {
    res.status(201).json(await generateProjectScript(idParam(req), scriptParamsSchema.parse(req.body ?? {})));
  }),
);

api.patch(
  '/projects/:id/script',
  h((req, res) => {
    res.json(updateScript(idParam(req), scriptPatchSchema.parse(req.body ?? {})));
  }),
);
