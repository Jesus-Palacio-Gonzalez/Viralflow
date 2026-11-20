/**
 * Subtítulos en formato ASS (los quema FFmpeg con libass).
 *
 * El texto de cada escena se parte en fragmentos cortos y se reparte en el tiempo de su voz
 * en proporción al largo de cada fragmento. No hay marcas de tiempo palabra por palabra: la
 * voz sintética habla a ritmo bastante uniforme, así que el desfase es de décimas de segundo.
 */

export type CaptionPreset = 'classic' | 'yellow' | 'boxed';
export type CaptionPosition = 'bottom' | 'center' | 'top';

export interface CaptionOptions {
  enabled: boolean;
  preset: CaptionPreset;
  position: CaptionPosition;
  uppercase: boolean;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export const FONT_FAMILY = 'Inter ExtraBold';
export const FONT_FILE = 'Inter-ExtraBold.otf';

/** Parte un texto en fragmentos de pocas palabras que quepan en una línea. */
export function chunkWords(text: string, maxWords: number, maxChars: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.length) chunks.push(current.join(' '));
    current = [];
  };
  for (const word of words) {
    const next = [...current, word].join(' ');
    if (current.length > 0 && (current.length >= maxWords || next.length > maxChars)) flush();
    current.push(word);
    // Cortar al final de una frase mejora la lectura: el siguiente fragmento empieza limpio.
    if (/[.!?…]$/.test(word)) flush();
  }
  flush();
  return chunks;
}

const MIN_CUE_S = 0.3;

/** Reparte `durationS` entre los fragmentos según su largo en caracteres. */
export function timeChunks(chunks: string[], durationS: number, startS = 0): Cue[] {
  if (chunks.length === 0 || durationS <= 0) return [];
  const weights = chunks.map((c) => c.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const cues: Cue[] = [];
  let cursor = startS;
  chunks.forEach((text, i) => {
    const isLast = i === chunks.length - 1;
    const share = (weights[i]! / total) * durationS;
    const end = isLast ? startS + durationS : cursor + Math.max(share, MIN_CUE_S);
    cues.push({ start: cursor, end: Math.min(end, startS + durationS), text });
    cursor = cues.at(-1)!.end;
  });
  return cues.filter((c) => c.end - c.start > 0.02);
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Tiempo ASS: H:MM:SS.cc (centésimas). */
export function assTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 100));
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000) % 60;
  const h = Math.floor(total / 360000);
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/** El texto de un diálogo ASS no admite llaves (son códigos de estilo) ni saltos sin escapar. */
export function assEscape(text: string): string {
  return text.replace(/[{}]/g, '').replace(/\\/g, '').replace(/\r?\n/g, '\\N').trim();
}

interface PresetStyle {
  primary: string;
  outline: string;
  borderStyle: 1 | 3;
  outlineFactor: number;
}

// Los colores ASS van en BGR con canal alfa al inicio (&HAABBGGRR).
const PRESETS: Record<CaptionPreset, PresetStyle> = {
  classic: { primary: '&H00FFFFFF', outline: '&H00000000', borderStyle: 1, outlineFactor: 0.085 },
  yellow: { primary: '&H0000E5FF', outline: '&H00000000', borderStyle: 1, outlineFactor: 0.085 },
  boxed: { primary: '&H00FFFFFF', outline: '&H99000000', borderStyle: 3, outlineFactor: 0.16 },
};

export interface AssInput {
  width: number;
  height: number;
  /** Porcentaje del alto que la app de la plataforma tapa arriba y abajo. */
  safeTopPct: number;
  safeBottomPct: number;
  options: CaptionOptions;
  captions: Cue[];
  /** Textos en pantalla (refuerzos cortos), mostrados en la zona alta. */
  titles: Cue[];
}

export const isPortrait = (width: number, height: number): boolean => height >= width;

/** Límites de fragmento según la orientación: en vertical caben menos caracteres por línea. */
export function chunkLimits(width: number, height: number): { maxWords: number; maxChars: number } {
  return isPortrait(width, height) ? { maxWords: 3, maxChars: 18 } : { maxWords: 5, maxChars: 32 };
}

export function buildAss(input: AssInput): string {
  const { width, height, options } = input;
  const preset = PRESETS[options.preset];
  const base = Math.min(width, height);
  const fontSize = Math.round(base * 0.08);
  const titleSize = Math.round(base * 0.058);
  const outline = Math.round(fontSize * preset.outlineFactor);
  const sideMargin = Math.round(width * 0.06);
  const safeTop = Math.round((height * input.safeTopPct) / 100);
  const safeBottom = Math.round((height * input.safeBottomPct) / 100);

  // alignment: 2 = abajo centro, 5 = centro, 8 = arriba centro
  const captionAlign = options.position === 'bottom' ? 2 : options.position === 'center' ? 5 : 8;
  const captionMarginV = options.position === 'bottom' ? safeBottom : options.position === 'top' ? safeTop : 0;
  // Si los subtítulos van arriba, el texto en pantalla baja para no pisarlos.
  const titleMarginV = options.position === 'top' ? safeTop + Math.round(fontSize * 2.4) : safeTop + Math.round(height * 0.03);

  const style = (name: string, size: number, align: number, marginV: number, p: PresetStyle): string =>
    `Style: ${name},${FONT_FAMILY},${size},${p.primary},${p.primary},${p.outline},&H00000000,0,0,0,0,100,100,0,0,${p.borderStyle},${
      name === 'Title' ? Math.round(size * 0.1) : outline
    },0,${align},${sideMargin},${sideMargin},${marginV},1`;

  const titleStyle: PresetStyle = { primary: '&H00FFFFFF', outline: '&H00000000', borderStyle: 1, outlineFactor: 0.1 };
  const fmt = (t: string): string => assEscape(options.uppercase ? t.toLocaleUpperCase('es') : t);

  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    style('Caption', fontSize, captionAlign, captionMarginV, preset),
    style('Title', titleSize, 8, titleMarginV, titleStyle),
    '',
    '[Events]',
    'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
    ...input.titles.map((c) => `Dialogue: 1,${assTime(c.start)},${assTime(c.end)},Title,,0,0,0,,${assEscape(c.text)}`),
    ...input.captions.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Caption,,0,0,0,,${fmt(c.text)}`),
  ];
  return lines.join('\n') + '\n';
}
