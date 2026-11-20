import { config } from './config.js';
import { AppError } from './errors.js';
import { addQuota } from './quota.js';
import type { RawChannel, RawVideo } from './types.js';
import { chunk, parseDuration } from './util.js';

const BASE = 'https://www.googleapis.com/youtube/v3';

/** Costo en unidades de cuota de cada endpoint (documentación oficial de YouTube Data API v3). */
export const COST = { search: 100, list: 1 } as const;

type Params = Record<string, string | number | undefined>;

function mapError(status: number, body: any): AppError {
  const reason: string | undefined = body?.error?.errors?.[0]?.reason;
  const message: string = body?.error?.message ?? `HTTP ${status}`;

  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || reason === 'rateLimitExceeded') {
    return new AppError(
      429,
      'QUOTA_EXCEEDED',
      'Se agotó la cuota diaria de la API de YouTube. Se reinicia a medianoche, hora del Pacífico (entre las 2 y las 3 a.m. en Colombia).',
    );
  }
  if (reason === 'keyInvalid' || /API key not valid/i.test(message)) {
    return new AppError(400, 'BAD_API_KEY', 'La API key de YouTube no es válida. Revisa YOUTUBE_API_KEY en el archivo .env.');
  }
  if (reason === 'accessNotConfigured' || /has not been used in project|is disabled/i.test(message)) {
    return new AppError(
      403,
      'API_DISABLED',
      'La YouTube Data API v3 no está habilitada en tu proyecto de Google Cloud. Habilítala en "APIs y servicios" > "Biblioteca".',
    );
  }
  if (/referer|ip address|restrict/i.test(message)) {
    return new AppError(
      403,
      'KEY_RESTRICTED',
      'La API key tiene restricciones (referrer o IP) que bloquean las llamadas desde el servidor. Quita la restricción de aplicación o usa "Ninguna".',
    );
  }
  if (reason === 'videoChartNotFound') {
    return new AppError(404, 'CHART_NOT_FOUND', 'Esa categoría no tiene ranking de tendencias en la región elegida.');
  }
  return new AppError(502, 'YOUTUBE_ERROR', `Error de la API de YouTube: ${message}`);
}

async function call(path: string, params: Params, cost: number): Promise<any> {
  if (!config.youtubeApiKey) {
    throw new AppError(400, 'NO_API_KEY', 'Falta YOUTUBE_API_KEY. Agrégala al archivo .env y reinicia el servidor.');
  }
  const url = new URL(`${BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  url.searchParams.set('key', config.youtubeApiKey);

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    // No se incluye el mensaje original: podría contener la URL con la API key.
    throw new AppError(502, 'NETWORK', `No se pudo contactar la API de YouTube (${(err as Error).name}). Revisa tu conexión.`);
  }
  addQuota(cost);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw mapError(res.status, body);
  return body;
}

const toNum = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : Number(v));

function mapVideo(item: any): RawVideo {
  const sn = item.snippet ?? {};
  const st = item.statistics ?? {};
  const cd = item.contentDetails ?? {};
  const thumbs = sn.thumbnails ?? {};
  return {
    id: String(item.id),
    channelId: String(sn.channelId ?? ''),
    channelTitle: String(sn.channelTitle ?? ''),
    title: String(sn.title ?? ''),
    description: String(sn.description ?? ''),
    thumbnail: String(thumbs.maxres?.url ?? thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? ''),
    publishedAt: String(sn.publishedAt ?? ''),
    durationS: parseDuration(String(cd.duration ?? '')),
    categoryId: sn.categoryId ? String(sn.categoryId) : null,
    tags: Array.isArray(sn.tags) ? sn.tags.slice(0, 30).map(String) : [],
    language: sn.defaultAudioLanguage ?? sn.defaultLanguage ?? null,
    views: Number(st.viewCount ?? 0),
    likes: toNum(st.likeCount),
    comments: toNum(st.commentCount),
    liveBroadcast: String(sn.liveBroadcastContent ?? 'none'),
  };
}

export interface SearchOptions {
  query: string;
  regionCode: string;
  language?: string;
  publishedAfter: Date;
  order: 'viewCount' | 'date' | 'relevance';
  shortOnly: boolean;
  pages: number;
}

/** search.list — 100 unidades por página. Devuelve solo IDs; los detalles salen de videos.list. */
export async function searchVideoIds(opts: SearchOptions): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < opts.pages; page++) {
    const body = await call(
      'search',
      {
        part: 'snippet',
        type: 'video',
        q: opts.query,
        order: opts.order,
        publishedAfter: opts.publishedAfter.toISOString(),
        regionCode: opts.regionCode,
        relevanceLanguage: opts.language,
        videoDuration: opts.shortOnly ? 'short' : undefined,
        maxResults: 50,
        pageToken,
      },
      COST.search,
    );
    for (const item of body.items ?? []) {
      if (item?.id?.videoId) ids.push(String(item.id.videoId));
    }
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return ids;
}

/** videos.list por IDs — 1 unidad por cada 50 videos. */
export async function getVideos(ids: string[]): Promise<RawVideo[]> {
  const out: RawVideo[] = [];
  for (const group of chunk([...new Set(ids)], 50)) {
    const body = await call(
      'videos',
      { part: 'snippet,contentDetails,statistics', id: group.join(','), maxResults: 50 },
      COST.list,
    );
    for (const item of body.items ?? []) out.push(mapVideo(item));
  }
  return out;
}

/** videos.list chart=mostPopular — 1 unidad por página. Una categoría sin ranking devuelve []. */
export async function mostPopular(opts: { regionCode: string; categoryId?: string; pages: number }): Promise<RawVideo[]> {
  const out: RawVideo[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < opts.pages; page++) {
    let body: any;
    try {
      body = await call(
        'videos',
        {
          part: 'snippet,contentDetails,statistics',
          chart: 'mostPopular',
          regionCode: opts.regionCode,
          videoCategoryId: opts.categoryId,
          maxResults: 50,
          pageToken,
        },
        COST.list,
      );
    } catch (err) {
      if (err instanceof AppError && err.code === 'CHART_NOT_FOUND') return out;
      throw err;
    }
    for (const item of body.items ?? []) out.push(mapVideo(item));
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/** channels.list — 1 unidad por cada 50 canales. */
export async function getChannels(ids: string[]): Promise<RawChannel[]> {
  const out: RawChannel[] = [];
  for (const group of chunk([...new Set(ids)].filter(Boolean), 50)) {
    const body = await call('channels', { part: 'snippet,statistics', id: group.join(','), maxResults: 50 }, COST.list);
    for (const item of body.items ?? []) {
      const st = item.statistics ?? {};
      out.push({
        id: String(item.id),
        title: String(item.snippet?.title ?? ''),
        subscribers: st.hiddenSubscriberCount ? null : toNum(st.subscriberCount),
        videoCount: toNum(st.videoCount),
        viewCount: toNum(st.viewCount),
      });
    }
  }
  return out;
}
