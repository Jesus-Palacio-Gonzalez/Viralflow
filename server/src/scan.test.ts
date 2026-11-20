/**
 * Prueba de integración con la API de YouTube simulada: no consume cuota ni necesita red.
 * Usa una base de datos y una carpeta de proyectos temporales.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viralflow-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.WORKSPACE_DIR = path.join(tmp, 'workspace');
process.env.YOUTUBE_API_KEY = 'clave-de-prueba';
process.env.YOUTUBE_DAILY_QUOTA = '10000';

const hoursAgo = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();

const VIDEOS: Record<string, any> = {
  v1: { channel: 'c1', title: 'Corto explosivo', dur: 'PT45S', age: 5, views: '50000', likes: '4000', comments: '300' },
  v2: { channel: 'c2', title: 'Corto normal', dur: 'PT1M30S', age: 48, views: '8000', likes: '200', comments: '10' },
  v3: { channel: 'c1', title: 'Video largo', dur: 'PT10M', age: 30, views: '20000', likes: '900', comments: '40' },
};
const CHANNELS: Record<string, any> = {
  c1: { title: 'Canal pequeño', subs: '2000' },
  c2: { title: 'Canal grande', subs: '500000' },
};

let failWith: { status: number; reason: string } | null = null;
const calls: string[] = [];

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = (async (input: URL | string) => {
  const url = new URL(String(input));
  const endpoint = url.pathname.split('/').pop()!;
  calls.push(endpoint);
  assert.equal(url.searchParams.get('key'), 'clave-de-prueba');

  if (failWith) {
    return json({ error: { message: 'cuota', errors: [{ reason: failWith.reason }] } }, failWith.status);
  }
  if (endpoint === 'search') {
    assert.equal(url.searchParams.get('type'), 'video');
    assert.equal(url.searchParams.get('videoDuration'), 'short');
    return json({ items: Object.keys(VIDEOS).map((id) => ({ id: { videoId: id } })) });
  }
  if (endpoint === 'videos') {
    const ids = (url.searchParams.get('id') ?? '').split(',').filter(Boolean);
    return json({
      items: ids.map((id) => {
        const v = VIDEOS[id];
        return {
          id,
          snippet: {
            channelId: v.channel,
            channelTitle: CHANNELS[v.channel].title,
            title: v.title,
            description: 'descripción',
            publishedAt: hoursAgo(v.age),
            categoryId: '22',
            tags: ['motivación'],
            thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hq.jpg` } },
            liveBroadcastContent: 'none',
          },
          contentDetails: { duration: v.dur },
          statistics: { viewCount: v.views, likeCount: v.likes, commentCount: v.comments },
        };
      }),
    });
  }
  if (endpoint === 'channels') {
    const ids = (url.searchParams.get('id') ?? '').split(',').filter(Boolean);
    return json({
      items: ids.map((id) => ({
        id,
        snippet: { title: CHANNELS[id].title },
        statistics: { subscriberCount: CHANNELS[id].subs, videoCount: '100', viewCount: '1000000' },
      })),
    });
  }
  return json({ error: { message: 'endpoint inesperado' } }, 404);
}) as typeof fetch;

// Los módulos leen el entorno al importarse, por eso se cargan después de configurarlo.
const { db } = await import('./db.js');
const { scanSchema, runScan } = await import('./scanner.js');
const { quotaStatus } = await import('./quota.js');
const { queryVideos } = await import('./videos.js');
const { computeNicheStats } = await import('./analytics.js');
const { createProject, deleteProject, projectTree, updateProject } = await import('./projects.js');

const niche = db.prepare("SELECT id, slug, name, query, builtin FROM niches WHERE slug = 'motivacion'").get() as any;

test('un escaneo de nicho filtra videos largos, guarda todo y cuenta la cuota', async () => {
  const params = scanSchema.parse({ mode: 'niches', nicheIds: [niche.id] });
  const summary = await runScan(params);

  assert.equal(summary.found, 2, 'el video de 10 min queda fuera del filtro de cortos');
  assert.equal(summary.inserted, 2);
  assert.equal(summary.unitsUsed, 102, 'search (100) + videos (1) + channels (1)');
  assert.equal(quotaStatus().used, 102);
  assert.deepEqual(calls, ['search', 'videos', 'channels']);

  const { total, videos } = queryVideos({
    days: 14,
    duration: 'short',
    minScore: 0,
    sort: 'score',
    limit: 10,
    offset: 0,
  });
  assert.equal(total, 2);
  assert.equal(videos[0]!.id, 'v1', 'el corto que supera a su canal pequeño va primero');
  assert.equal(videos[0]!.subscribers, 2000);
  assert.equal(videos[0]!.metrics.ratio, 25);
  assert.deepEqual(videos[0]!.niches, [niche.id]);
  assert.ok(videos[0]!.metrics.score > videos[1]!.metrics.score);

  const stats = computeNicheStats(
    queryVideos({ days: 30, duration: 'any', minScore: 0, sort: 'score', limit: 50, offset: 0 }).videos,
    [niche],
  );
  assert.equal(stats[0]!.videos, 2);
  assert.equal(stats[0]!.smallChannelWins, 1);
});

test('un segundo escaneo actualiza en vez de duplicar y agrega un snapshot', async () => {
  const summary = await runScan(scanSchema.parse({ mode: 'niches', nicheIds: [niche.id] }));
  assert.equal(summary.inserted, 0);
  assert.equal(summary.updated, 2);
  const n = (db.prepare("SELECT COUNT(*) AS n FROM video_snapshots WHERE video_id = 'v1'").get() as any).n;
  assert.equal(n, 2);
});

test('rechaza escaneos que superan la cuota restante', async () => {
  db.prepare('UPDATE quota_usage SET units = 9950').run();
  await assert.rejects(
    runScan(scanSchema.parse({ mode: 'niches', nicheIds: [niche.id] })),
    (err: any) => err.code === 'QUOTA_LOW',
  );
  db.prepare('UPDATE quota_usage SET units = 0').run();
});

test('traduce el error de cuota de YouTube y registra el escaneo como fallido', async () => {
  failWith = { status: 403, reason: 'quotaExceeded' };
  await assert.rejects(
    runScan(scanSchema.parse({ mode: 'keyword', query: 'prueba' })),
    (err: any) => err.code === 'QUOTA_EXCEEDED',
  );
  failWith = null;
  const last = db.prepare('SELECT status FROM scans ORDER BY id DESC LIMIT 1').get() as any;
  assert.equal(last.status, 'error');
});

test('un proyecto crea su estructura de carpetas, formatos y referencia', () => {
  const project = createProject({ name: 'Mi primer proyecto', videoId: 'v1', platforms: ['tiktok', 'youtube-shorts'] });
  const folder = project.folder;

  assert.ok(fs.existsSync(path.join(folder, '00-referencia', 'video.json')));
  assert.ok(fs.existsSync(path.join(folder, '03-prompts-flow')));
  assert.ok(fs.existsSync(path.join(folder, '07-exportados', 'tiktok', 'format.json')));
  assert.ok(fs.existsSync(path.join(folder, '07-exportados', 'youtube-shorts')));
  assert.ok(fs.existsSync(path.join(folder, 'README.md')));
  assert.equal(project.reference?.title, 'Corto explosivo');
  assert.equal(project.stage, 'referencia');

  const format = JSON.parse(fs.readFileSync(path.join(folder, '07-exportados', 'tiktok', 'format.json'), 'utf8'));
  assert.equal(format.width, 1080);
  assert.equal(format.height, 1920);

  const names = projectTree(project.id).map((n) => n.name);
  assert.ok(names.includes('00-referencia') && names.includes('07-exportados'));

  assert.equal(updateProject(project.id, { stage: 'guion' }).stage, 'guion');

  const again = createProject({ name: 'Mi primer proyecto', platforms: ['tiktok'] });
  assert.notEqual(again.slug, project.slug, 'los nombres repetidos obtienen otra carpeta');

  deleteProject(project.id, true);
  assert.ok(!fs.existsSync(folder));
  deleteProject(again.id, false);
  assert.ok(fs.existsSync(again.folder), 'sin deleteFiles la carpeta se conserva');
});

test('rechaza formatos desconocidos', () => {
  assert.throws(() => createProject({ name: 'Otro', platforms: ['myspace'] }), /Formato desconocido/);
});

test.after(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
