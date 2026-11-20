import type { ScoreResult } from './scoring.js';

/** Video tal como llega de la API de YouTube (ya normalizado). */
export interface RawVideo {
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  thumbnail: string;
  publishedAt: string;
  durationS: number;
  categoryId: string | null;
  tags: string[];
  language: string | null;
  views: number;
  likes: number | null;
  comments: number | null;
  liveBroadcast: string;
}

export interface RawChannel {
  id: string;
  title: string;
  subscribers: number | null;
  videoCount: number | null;
  viewCount: number | null;
}

/** Video listo para el cliente, con su puntaje calculado. */
export interface VideoDTO {
  id: string;
  url: string;
  title: string;
  description: string;
  thumbnail: string;
  publishedAt: string;
  durationS: number;
  categoryId: string | null;
  categoryName: string | null;
  tags: string[];
  language: string | null;
  views: number;
  likes: number | null;
  comments: number | null;
  channelId: string;
  channelTitle: string;
  subscribers: number | null;
  source: 'youtube' | 'demo';
  niches: number[];
  /** Vistas/hora entre los dos últimos snapshots (null si aún no hay suficientes). */
  growthVph: number | null;
  metrics: ScoreResult;
}

export interface NicheRow {
  id: number;
  slug: string;
  name: string;
  query: string;
  builtin: boolean;
}

export interface NicheStat extends NicheRow {
  videos: number;
  channels: number;
  avgScore: number;
  topScore: number;
  avgVph: number;
  /** Videos de canales pequeños que superaron claramente a su canal. */
  smallChannelWins: number;
  /** % de videos del nicho que son victorias de canales pequeños (0–100). */
  opportunity: number;
  nicheScore: number;
  /** Muestra insuficiente para fiarse del ranking. */
  lowSample: boolean;
  topVideoId: string | null;
}

export interface TermStat {
  term: string;
  videos: number;
  channels: number;
  avgScore: number;
}
