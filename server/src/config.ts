import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/** Raíz del repositorio (server/src y server/dist están a la misma profundidad). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num(process.env.PORT, 3001),
  youtubeApiKey: process.env.YOUTUBE_API_KEY?.trim() || null,
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() || null,
  geminiModel: process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash',
  /** Solo se cambia en pruebas (servidor simulado). La clave viaja en un encabezado a esta dirección. */
  geminiBaseUrl: (process.env.GEMINI_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
  geminiRetryDelayMs: num(process.env.GEMINI_RETRY_DELAY_MS, 1500),
  geminiTtsModel: process.env.GEMINI_TTS_MODEL?.trim() || 'gemini-3.8-flash-tts',
  /** Espera antes de reintentar la voz cuando Gemini limita las peticiones por minuto. */
  ttsRetryDelayMs: num(process.env.TTS_RETRY_DELAY_MS, 20_000),
  fontsDir: path.join(ROOT, 'assets', 'fonts'),
  dailyQuotaLimit: num(process.env.YOUTUBE_DAILY_QUOTA, 10_000),
  workspaceDir: path.resolve(ROOT, process.env.WORKSPACE_DIR ?? 'workspace'),
  dbPath: path.resolve(ROOT, process.env.DB_PATH ?? 'data/viralflow.db'),
};
