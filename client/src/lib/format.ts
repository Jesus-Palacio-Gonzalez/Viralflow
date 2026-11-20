export const cn = (...classes: Array<string | false | null | undefined>): string => classes.filter(Boolean).join(' ');

const compact = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('es-CO');

export const fmtNum = (n: number | null | undefined): string => (n == null ? '—' : compact.format(n));
export const fmtInt = (n: number | null | undefined): string => (n == null ? '—' : full.format(n));

export function fmtAge(hours: number): string {
  if (hours < 1.5) return 'hace 1 h';
  if (hours < 48) return `hace ${Math.round(hours)} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

export function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type Rgb = [number, number, number];

function mix(stops: Array<[number, Rgb]>, t: number): string {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]!;
    const [t0, c0] = stops[i - 1]!;
    if (x <= t1) {
      const k = (x - t0) / (t1 - t0);
      const rgb = c0.map((v, j) => Math.round(v + (c1[j]! - v) * k));
      return `rgb(${rgb.join(' ')})`;
    }
  }
  const last = stops[stops.length - 1]![1];
  return `rgb(${last.join(' ')})`;
}

/** Color de relleno de la escala térmica (para fondos y barras). */
export const heatFill = (score: number): string =>
  mix(
    [
      [0, [58, 99, 255]],
      [0.62, [255, 61, 110]],
      [1, [255, 176, 32]],
    ],
    score / 100,
  );

/** Versión más luminosa para texto sobre fondo oscuro (contraste AA). */
export const heatText = (score: number): string =>
  mix(
    [
      [0, [124, 150, 255]],
      [0.62, [255, 98, 142]],
      [1, [255, 192, 72]],
    ],
    score / 100,
  );
