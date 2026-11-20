import type { NicheRow, NicheStat, TermStat, VideoDTO } from './types.js';

/** Un canal "pequeño" tiene menos suscriptores que esto. */
export const SMALL_CHANNEL_SUBS = 100_000;
/** Un video "gana" si supera por esta cantidad de veces a su canal… */
export const WIN_RATIO = 3;
/** …y además alcanza al menos estas vistas. */
export const WIN_MIN_VIEWS = 10_000;

const avg = (values: number[]): number => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const round1 = (n: number): number => Math.round(n * 10) / 10;

export function isSmallChannelWin(v: VideoDTO): boolean {
  return (
    v.subscribers != null &&
    v.subscribers < SMALL_CHANNEL_SUBS &&
    (v.metrics.ratio ?? 0) >= WIN_RATIO &&
    v.views >= WIN_MIN_VIEWS
  );
}

/**
 * Ranking de nichos. nicheScore = 50% promedio de los 5 mejores videos + 25% promedio general
 * + 25% oportunidad (porcentaje de videos de canales pequeños que explotaron). Así un nicho
 * sube si tiene picos altos y además es accesible para canales nuevos.
 */
export function computeNicheStats(videos: VideoDTO[], niches: NicheRow[]): NicheStat[] {
  const stats = niches.map((niche): NicheStat => {
    const items = videos.filter((v) => v.niches.includes(niche.id));
    if (items.length === 0) {
      return {
        ...niche,
        videos: 0,
        channels: 0,
        avgScore: 0,
        topScore: 0,
        avgVph: 0,
        smallChannelWins: 0,
        opportunity: 0,
        nicheScore: 0,
        lowSample: true,
        topVideoId: null,
      };
    }
    const sorted = [...items].sort((a, b) => b.metrics.score - a.metrics.score);
    const channels = new Set(items.map((v) => v.channelId)).size;
    const wins = items.filter(isSmallChannelWin).length;
    const opportunity = (wins / items.length) * 100;
    const top5 = avg(sorted.slice(0, 5).map((v) => v.metrics.score));
    const mean = avg(items.map((v) => v.metrics.score));
    return {
      ...niche,
      videos: items.length,
      channels,
      avgScore: round1(mean),
      topScore: sorted[0]!.metrics.score,
      avgVph: round1(avg(items.map((v) => v.metrics.effectiveVph))),
      smallChannelWins: wins,
      opportunity: round1(opportunity),
      nicheScore: round1(0.5 * top5 + 0.25 * mean + 0.25 * opportunity),
      lowSample: items.length < 5 || channels < 3,
      topVideoId: sorted[0]!.id,
    };
  });
  return stats.sort((a, b) => b.nicheScore - a.nicheScore || b.videos - a.videos);
}

const STOPWORDS = new Set(
  (
    'shorts short video videos viral youtube fyp parati tiktok reels como para esto este esta estos estas pero porque ' +
    'todo todos todas cuando donde sobre desde hasta entre tiene tienen hacer hace solo algo mejor nunca siempre ' +
    'cada otro otra tambien después antes ahora aqui aquí así vamos puedes puede quien que con por una uno unos ' +
    'the and for you your that this with from what have will they about best how why when ' +
    'más mas muy son sus los las del nadie cuenta cambió cambio forma cosas cosa debes deben hacen tengo tienes ' +
    'estoy están estan había sido ellos ellas nosotros esto eso aquel quiero quieres vez veces dice dicen ' +
    'hoy ayer mismo misma mismos parte partes tipo gran grande nuevo nueva nuevos nuevas primer primera ' +
    'segundos minutos segundo minuto pasa pasó paso qué cómo cuál cuáles dónde'
  ).split(' '),
);

function termsOf(video: VideoDTO): Set<string> {
  const terms = new Set<string>();
  for (const raw of video.tags) {
    const tag = raw.toLowerCase().trim().replace(/^#/, '');
    if (tag.length >= 3 && tag.length <= 30 && !STOPWORDS.has(tag)) terms.add(tag);
  }
  const words = video.title.toLowerCase().match(/[\p{L}]{4,}/gu) ?? [];
  for (const w of words) if (!STOPWORDS.has(w)) terms.add(w);
  return terms;
}

/** Términos (etiquetas y palabras de títulos) que se repiten entre varios canales distintos de videos fuertes. */
export function computeTrendingTerms(videos: VideoDTO[], limit = 30): TermStat[] {
  const acc = new Map<string, { videos: number; channels: Set<string>; scoreSum: number }>();
  for (const v of videos) {
    for (const term of termsOf(v)) {
      const entry = acc.get(term) ?? { videos: 0, channels: new Set<string>(), scoreSum: 0 };
      entry.videos++;
      entry.channels.add(v.channelId);
      entry.scoreSum += v.metrics.score;
      acc.set(term, entry);
    }
  }
  return [...acc.entries()]
    .filter(([, e]) => e.videos >= 3 && e.channels.size >= 2)
    .map(([term, e]): TermStat & { weight: number } => {
      const avgScore = e.scoreSum / e.videos;
      return {
        term,
        videos: e.videos,
        channels: e.channels.size,
        avgScore: round1(avgScore),
        weight: avgScore * Math.log2(e.videos + 1),
      };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map(({ weight: _weight, ...rest }) => rest);
}
