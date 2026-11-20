import { z } from 'zod';
import { DEFAULT_TRENDING_CATEGORIES } from './categories.js';
import { config } from './config.js';
import { db } from './db.js';
import { AppError } from './errors.js';
import { quotaStatus, quotaUsed } from './quota.js';
import { saveBatch, type StoredVideo } from './store.js';
import type { RawVideo } from './types.js';
import { MAX_SHORT_SECONDS } from './videos.js';
import { getChannels, getVideos, mostPopular, searchVideoIds } from './youtube.js';

export const scanSchema = z.object({
  /** niches: busca cada nicho elegido · trending: ranking de tendencias por categoría · keyword: una búsqueda libre */
  mode: z.enum(['niches', 'trending', 'keyword']),
  nicheIds: z.array(z.number().int().positive()).max(25).optional(),
  query: z.string().trim().min(2).max(100).optional(),
  regionCode: z
    .string()
    .length(2)
    .transform((s) => s.toUpperCase())
    .default('CO'),
  language: z.string().min(2).max(5).default('es'),
  publishedWithinDays: z.number().int().min(1).max(90).default(14),
  duration: z.enum(['short', 'any']).default('short'),
  order: z.enum(['viewCount', 'date', 'relevance']).default('viewCount'),
  pages: z.number().int().min(1).max(3).default(1),
  categoryIds: z
    .array(z.string().regex(/^\d+$/))
    .max(15)
    .optional(),
});

export type ScanParams = z.infer<typeof scanSchema>;

function assertParams(p: ScanParams): void {
  if (p.mode === 'niches' && !p.nicheIds?.length) {
    throw new AppError(400, 'BAD_SCAN', 'Elige al menos un nicho para escanear.');
  }
  if (p.mode === 'keyword' && !p.query) {
    throw new AppError(400, 'BAD_SCAN', 'Escribe la palabra clave que quieres buscar.');
  }
}

/**
 * Costo estimado en unidades de cuota: search.list cuesta 100 por página; videos.list y channels.list
 * cuestan 1 por llamada (se suman ~2 por página para detalles y suscriptores).
 */
export function estimateCost(p: ScanParams): number {
  if (p.mode === 'trending') {
    const categories = p.categoryIds?.length ?? DEFAULT_TRENDING_CATEGORIES.length;
    return categories * p.pages * 2;
  }
  const queries = p.mode === 'niches' ? (p.nicheIds?.length ?? 0) : 1;
  return queries * p.pages * 102;
}

export interface ScanSummary {
  scanId: number;
  found: number;
  inserted: number;
  updated: number;
  unitsUsed: number;
  warning?: string;
}

let running = false;
export const isScanRunning = (): boolean => running;

export async function runScan(p: ScanParams): Promise<ScanSummary> {
  assertParams(p);
  if (!config.youtubeApiKey) {
    throw new AppError(
      400,
      'NO_API_KEY',
      'Falta YOUTUBE_API_KEY. Agrégala al archivo .env y reinicia el servidor (o carga datos de demo para probar).',
    );
  }
  if (running) throw new AppError(409, 'SCAN_RUNNING', 'Ya hay un escaneo en curso. Espera a que termine.');

  const cost = estimateCost(p);
  const quota = quotaStatus();
  if (cost > quota.remaining) {
    throw new AppError(
      429,
      'QUOTA_LOW',
      `Este escaneo cuesta unas ${cost} unidades y hoy te quedan ${quota.remaining}. Reduce nichos o páginas.`,
    );
  }

  let niches: Array<{ id: number; query: string }> = [];
  if (p.mode === 'niches') {
    const ids = p.nicheIds!;
    niches = db
      .prepare(`SELECT id, query FROM niches WHERE id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids) as Array<{ id: number; query: string }>;
    if (niches.length === 0) throw new AppError(400, 'BAD_SCAN', 'Los nichos elegidos no existen.');
  }

  running = true;
  const unitsBefore = quotaUsed();
  const scanId = Number(
    db
      .prepare('INSERT INTO scans (mode, params, status, started_at) VALUES (?, ?, ?, ?)')
      .run(p.mode, JSON.stringify(p), 'running', new Date().toISOString()).lastInsertRowid,
  );

  try {
    const collected = new Map<string, { raw: RawVideo; nicheIds: Set<number> }>();
    const add = (raw: RawVideo, nicheId?: number): void => {
      const entry = collected.get(raw.id) ?? { raw, nicheIds: new Set<number>() };
      if (nicheId) entry.nicheIds.add(nicheId);
      collected.set(raw.id, entry);
    };

    let warning: string | undefined;
    const since = new Date(Date.now() - p.publishedWithinDays * 86_400_000);

    try {
      if (p.mode === 'trending') {
        const categories = p.categoryIds?.length ? p.categoryIds : DEFAULT_TRENDING_CATEGORIES;
        for (const categoryId of categories) {
          for (const raw of await mostPopular({ regionCode: p.regionCode, categoryId, pages: p.pages })) add(raw);
        }
      } else {
        const targets = p.mode === 'niches' ? niches : [{ id: 0, query: p.query! }];
        for (const target of targets) {
          const ids = await searchVideoIds({
            query: target.query,
            regionCode: p.regionCode,
            language: p.language,
            publishedAfter: since,
            order: p.order,
            shortOnly: p.duration === 'short',
            pages: p.pages,
          });
          for (const raw of await getVideos(ids)) add(raw, target.id || undefined);
        }
      }
    } catch (err) {
      if (collected.size === 0) throw err;
      warning = `El escaneo se interrumpió antes de terminar (${(err as Error).message}). Se guardó lo recopilado hasta ese momento.`;
    }

    const keep: StoredVideo[] = [...collected.values()]
      .filter(({ raw }) => {
        if (raw.durationS <= 0 || raw.liveBroadcast !== 'none') return false;
        if (new Date(raw.publishedAt).getTime() < since.getTime()) return false;
        return p.duration === 'any' || raw.durationS <= MAX_SHORT_SECONDS;
      })
      .map(({ raw, nicheIds }) => ({ raw, nicheIds: [...nicheIds] }));

    let channels: Awaited<ReturnType<typeof getChannels>> = [];
    try {
      channels = await getChannels(keep.map((k) => k.raw.channelId));
    } catch (err) {
      warning ??= `No se pudieron leer los suscriptores de los canales (${(err as Error).message}); el puntaje usa las demás señales.`;
    }

    const { inserted, updated } = saveBatch(keep, channels, 'youtube');
    const unitsUsed = quotaUsed() - unitsBefore;

    db.prepare('UPDATE scans SET status = ?, found = ?, units_used = ?, message = ?, finished_at = ? WHERE id = ?').run(
      warning ? 'partial' : 'done',
      keep.length,
      unitsUsed,
      warning ?? null,
      new Date().toISOString(),
      scanId,
    );
    return { scanId, found: keep.length, inserted, updated, unitsUsed, warning };
  } catch (err) {
    db.prepare('UPDATE scans SET status = ?, units_used = ?, message = ?, finished_at = ? WHERE id = ?').run(
      'error',
      quotaUsed() - unitsBefore,
      (err as Error).message,
      new Date().toISOString(),
      scanId,
    );
    throw err;
  } finally {
    running = false;
  }
}
