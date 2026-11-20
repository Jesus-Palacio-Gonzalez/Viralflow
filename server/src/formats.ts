/**
 * Presets de formato por plataforma. Son una guía de partida (resolución, relación de aspecto y
 * duración habitual); las plataformas cambian sus límites con frecuencia, así que conviene
 * revisarlos antes de publicar.
 */
export interface FormatPreset {
  id: string;
  label: string;
  platform: string;
  aspect: '9:16' | '16:9' | '4:5' | '1:1';
  width: number;
  height: number;
  fps: number;
  /** Rango de duración con el que suele funcionar bien, en segundos. */
  recommendedSeconds: { min: number; max: number };
  container: 'mp4';
  videoCodec: 'h264';
  audioCodec: 'aac';
  /** Porcentaje del alto que conviene dejar libre para la interfaz de la app (subtítulos fuera de ahí). */
  safeZone: { topPct: number; bottomPct: number };
  notes: string[];
}

export const FORMATS: FormatPreset[] = [
  {
    id: 'tiktok',
    label: 'TikTok',
    platform: 'TikTok',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    recommendedSeconds: { min: 15, max: 60 },
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    safeZone: { topPct: 10, bottomPct: 22 },
    notes: ['Los subtítulos van quemados en el video.', 'Deja libre la parte baja: ahí se superpone la descripción.'],
  },
  {
    id: 'instagram-reels',
    label: 'Instagram Reels',
    platform: 'Instagram',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    recommendedSeconds: { min: 15, max: 60 },
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    safeZone: { topPct: 12, bottomPct: 20 },
    notes: ['Los elementos clave van en el centro: el feed recorta los bordes en la vista de perfil.'],
  },
  {
    id: 'youtube-shorts',
    label: 'YouTube Shorts',
    platform: 'YouTube',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    recommendedSeconds: { min: 15, max: 60 },
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    safeZone: { topPct: 8, bottomPct: 20 },
    notes: ['YouTube permite Shorts de más duración, pero 60 s o menos es lo más habitual.'],
  },
  {
    id: 'facebook-reels',
    label: 'Facebook Reels',
    platform: 'Facebook',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    recommendedSeconds: { min: 15, max: 60 },
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    safeZone: { topPct: 10, bottomPct: 20 },
    notes: ['Mismo formato vertical que Instagram Reels.'],
  },
  {
    id: 'instagram-feed',
    label: 'Instagram Feed (4:5)',
    platform: 'Instagram',
    aspect: '4:5',
    width: 1080,
    height: 1350,
    fps: 30,
    recommendedSeconds: { min: 15, max: 60 },
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    safeZone: { topPct: 6, bottomPct: 12 },
    notes: ['Ocupa más pantalla que el 1:1 en el feed.'],
  },
  {
    id: 'youtube-long',
    label: 'YouTube horizontal',
    platform: 'YouTube',
    aspect: '16:9',
    width: 1920,
    height: 1080,
    fps: 30,
    recommendedSeconds: { min: 120, max: 600 },
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    safeZone: { topPct: 5, bottomPct: 10 },
    notes: ['Formato clásico de YouTube para videos de más de un minuto.'],
  },
];

export const FORMAT_IDS = FORMATS.map((f) => f.id);

export function getFormat(id: string): FormatPreset | undefined {
  return FORMATS.find((f) => f.id === id);
}
