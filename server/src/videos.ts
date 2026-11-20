import { CATEGORIES } from './categories.js';
import { db } from './db.js';
import { scoreVideo } from './scoring.js';
import type { VideoDTO } from './types.js';

/** Un "corto" en este sistema dura 3 minutos o menos (límite de los Shorts actuales). */
export const MAX_SHORT_SECONDS = 180;

interface VideoRow {
  id: string;
  channel_id: string;
  title: string;
  description: string;
  thumbnail: string;
  published_at: string;
  duration_s: number;
  category_id: string | null;
  tags: string;
  language: string | null;
  views: number;
  likes: number | null;
  comments: number | null;
  source: 'youtube' | 'demo';
  channel_title: string | null;
  subscribers: number | null;
}

interface Snap {
  video_id: string;
  taken_at: string;
  views: number;
}

const SELECT_VIDEO = `
  SELECT v.*, c.title AS channel_title, c.subscribers AS subscribers
  FROM videos v LEFT JOIN channels c ON c.id = v.channel_id
`;

const HOUR = 3_600_000;

/** Vistas/hora entre el snapshot más reciente y uno anterior con al menos 1 h de diferencia. */
function growthFrom(snaps: Snap[] | undefined, now: number): number | null {
  if (!snaps || snaps.length < 2) return null;
  const latest = snaps[0]!;
  const latestAt = new Date(latest.taken_at).getTime();
  // Un snapshot demasiado viejo no describe la velocidad actual.
  if (now - latestAt > 72 * HOUR) return null;
  for (let i = 1; i < snaps.length; i++) {
    const older = snaps[i]!;
    const hours = (latestAt - new Date(older.taken_at).getTime()) / HOUR;
    if (hours >= 1) return Math.max(0, Math.round(((latest.views - older.views) / hours) * 10) / 10);
  }
  return null;
}

function toDTO(row: VideoRow, nicheIds: number[], snaps: Snap[] | undefined): VideoDTO {
  const growthVph = growthFrom(snaps, Date.now());
  return {
    id: row.id,
    url: `https://www.youtube.com/watch?v=${row.id}`,
    title: row.title,
    description: row.description.slice(0, 600),
    thumbnail: row.thumbnail,
    publishedAt: row.published_at,
    durationS: row.duration_s,
    categoryId: row.category_id,
    categoryName: row.category_id ? (CATEGORIES[row.category_id] ?? null) : null,
    tags: JSON.parse(row.tags) as string[],
    language: row.language,
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    channelId: row.channel_id,
    channelTitle: row.channel_title ?? '',
    subscribers: row.subscribers,
    source: row.source,
    niches: nicheIds,
    growthVph,
    metrics: scoreVideo({
      views: row.views,
      likes: row.likes,
      comments: row.comments,
      subscribers: row.subscribers,
      publishedAt: row.published_at,
      growthVph,
    }),
  };
}

export interface LoadFilters {
  days: number;
  duration: 'short' | 'any';
  nicheId?: number;
  q?: string;
}

/** Carga y puntúa todos los videos publicados dentro de la ventana de días. */
export function loadVideos(filters: LoadFilters): VideoDTO[] {
  const since = new Date(Date.now() - filters.days * 24 * HOUR).toISOString();
  const where = ['v.published_at >= @since'];
  const params: Record<string, unknown> = { since };

  if (filters.duration === 'short') {
    where.push('v.duration_s <= @maxDur');
    params.maxDur = MAX_SHORT_SECONDS;
  }
  if (filters.nicheId) {
    where.push('EXISTS (SELECT 1 FROM video_niches vn WHERE vn.video_id = v.id AND vn.niche_id = @nicheId)');
    params.nicheId = filters.nicheId;
  }
  if (filters.q) {
    where.push('(v.title LIKE @q OR c.title LIKE @q)');
    params.q = `%${filters.q}%`;
  }

  const rows = db.prepare(`${SELECT_VIDEO} WHERE ${where.join(' AND ')}`).all(params) as VideoRow[];
  if (rows.length === 0) return [];

  const snapRows = db
    .prepare(
      `SELECT s.video_id, s.taken_at, s.views FROM video_snapshots s
       JOIN videos v ON v.id = s.video_id WHERE v.published_at >= @since
       ORDER BY s.video_id, s.taken_at DESC`,
    )
    .all({ since }) as Snap[];
  const snapsByVideo = new Map<string, Snap[]>();
  for (const s of snapRows) {
    const list = snapsByVideo.get(s.video_id);
    if (list) list.push(s);
    else snapsByVideo.set(s.video_id, [s]);
  }

  const linkRows = db
    .prepare(
      `SELECT vn.video_id, vn.niche_id FROM video_niches vn
       JOIN videos v ON v.id = vn.video_id WHERE v.published_at >= @since`,
    )
    .all({ since }) as Array<{ video_id: string; niche_id: number }>;
  const nichesByVideo = new Map<string, number[]>();
  for (const l of linkRows) {
    const list = nichesByVideo.get(l.video_id);
    if (list) list.push(l.niche_id);
    else nichesByVideo.set(l.video_id, [l.niche_id]);
  }

  return rows.map((r) => toDTO(r, nichesByVideo.get(r.id) ?? [], snapsByVideo.get(r.id)));
}

export function getVideo(id: string): VideoDTO | null {
  const row = db.prepare(`${SELECT_VIDEO} WHERE v.id = ?`).get(id) as VideoRow | undefined;
  if (!row) return null;
  const snaps = db
    .prepare('SELECT video_id, taken_at, views FROM video_snapshots WHERE video_id = ? ORDER BY taken_at DESC')
    .all(id) as Snap[];
  const niches = (
    db.prepare('SELECT niche_id FROM video_niches WHERE video_id = ?').all(id) as Array<{ niche_id: number }>
  ).map((r) => r.niche_id);
  return toDTO(row, niches, snaps);
}

export type SortKey = 'score' | 'vph' | 'views' | 'ratio' | 'recent' | 'growth';

const SORTERS: Record<SortKey, (v: VideoDTO) => number> = {
  score: (v) => v.metrics.score,
  vph: (v) => v.metrics.effectiveVph,
  views: (v) => v.views,
  ratio: (v) => v.metrics.ratio ?? -1,
  recent: (v) => new Date(v.publishedAt).getTime(),
  growth: (v) => v.growthVph ?? -1,
};

export function queryVideos(
  filters: LoadFilters & { minScore: number; sort: SortKey; limit: number; offset: number },
): { total: number; videos: VideoDTO[] } {
  const all = loadVideos(filters).filter((v) => v.metrics.score >= filters.minScore);
  const key = SORTERS[filters.sort];
  all.sort((a, b) => key(b) - key(a));
  return { total: all.length, videos: all.slice(filters.offset, filters.offset + filters.limit) };
}
