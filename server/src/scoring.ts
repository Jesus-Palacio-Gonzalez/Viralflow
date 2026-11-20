/**
 * Puntaje viral (0–100).
 *
 * Combina cuatro señales, cada una normalizada a 0–100:
 *  - velocity   (40%): vistas por hora. Si hay snapshots previos usa el crecimiento reciente;
 *                      si no, vistas / horas desde la publicación (sirve como "velocidad de primeras horas").
 *  - outlier    (30%): vistas relativas al tamaño del canal (vistas / suscriptores). Un video que
 *                      supera varias veces a su canal es replicable aunque el canal sea pequeño.
 *  - engagement (15%): (likes + comentarios) / vistas.
 *  - reach      (15%): vistas absolutas en escala logarítmica.
 *
 * Si una señal no está disponible (suscriptores ocultos, likes ocultos) se reparte su peso
 * entre las demás en lugar de penalizar el video.
 */

export const WEIGHTS = { velocity: 0.4, outlier: 0.3, engagement: 0.15, reach: 0.15 } as const;

/** Valores a partir de los cuales cada señal llega a 100. */
export const CAPS = {
  vph: 20_000,
  ratio: 100,
  engagement: 0.1,
  views: 10_000_000,
} as const;

/** Canales con menos suscriptores que esto se tratan como si tuvieran este número. */
const MIN_SUBSCRIBERS = 1_000;

export interface ScoreInput {
  views: number;
  likes: number | null;
  comments: number | null;
  subscribers: number | null;
  publishedAt: string;
  /** Vistas por hora medidas entre dos snapshots, si existen. */
  growthVph?: number | null;
  now?: Date;
}

export interface ScoreResult {
  score: number;
  velocity: number;
  outlier: number | null;
  engagement: number | null;
  reach: number;
  ageHours: number;
  /** Vistas por hora desde la publicación. */
  vph: number;
  /** Vistas por hora que se usaron en el puntaje (crecimiento reciente si existe). */
  effectiveVph: number;
  /** Vistas / suscriptores del canal. */
  ratio: number | null;
  engagementRate: number | null;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const round1 = (n: number): number => Math.round(n * 10) / 10;
const logNorm = (x: number, cap: number): number =>
  clamp01(Math.log10(1 + Math.max(0, x)) / Math.log10(1 + cap)) * 100;

export function scoreVideo(input: ScoreInput): ScoreResult {
  const now = input.now ?? new Date();
  const ageHours = Math.max((now.getTime() - new Date(input.publishedAt).getTime()) / 3_600_000, 1);
  const vph = input.views / ageHours;
  const effectiveVph = input.growthVph != null ? Math.max(input.growthVph, 0) : vph;

  const velocity = logNorm(effectiveVph, CAPS.vph);

  const ratio = input.subscribers == null ? null : input.views / Math.max(input.subscribers, MIN_SUBSCRIBERS);
  const outlier = ratio == null ? null : logNorm(ratio, CAPS.ratio);

  const engagementRate =
    input.likes == null || input.views <= 0 ? null : (input.likes + (input.comments ?? 0)) / input.views;
  const engagement = engagementRate == null ? null : clamp01(engagementRate / CAPS.engagement) * 100;

  const reach = logNorm(input.views, CAPS.views);

  const parts: Array<[number | null, number]> = [
    [velocity, WEIGHTS.velocity],
    [outlier, WEIGHTS.outlier],
    [engagement, WEIGHTS.engagement],
    [reach, WEIGHTS.reach],
  ];
  let total = 0;
  let weight = 0;
  for (const [value, w] of parts) {
    if (value == null) continue;
    total += value * w;
    weight += w;
  }

  return {
    score: round1(weight > 0 ? total / weight : 0),
    velocity: round1(velocity),
    outlier: outlier == null ? null : round1(outlier),
    engagement: engagement == null ? null : round1(engagement),
    reach: round1(reach),
    ageHours: round1(ageHours),
    vph: round1(vph),
    effectiveVph: round1(effectiveVph),
    ratio: ratio == null ? null : round1(ratio),
    engagementRate: engagementRate == null ? null : Math.round(engagementRate * 10_000) / 10_000,
  };
}
