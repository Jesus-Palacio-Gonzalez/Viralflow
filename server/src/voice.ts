import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { AppError } from './errors.js';
import { synthesizeSpeech } from './gemini.js';
import { probeMedia } from './media.js';

/**
 * Voces prediseñadas de Gemini. Los nombres los valida la API; la descripción es orientativa
 * (usa «Probar voz» para oír cómo suena cada una en español antes de elegir).
 */
export const VOICES = [
  { id: 'Kore', label: 'Kore · firme' },
  { id: 'Charon', label: 'Charon · informativa' },
  { id: 'Puck', label: 'Puck · animada' },
  { id: 'Fenrir', label: 'Fenrir · enérgica' },
  { id: 'Orus', label: 'Orus · firme' },
  { id: 'Zephyr', label: 'Zephyr · brillante' },
  { id: 'Algenib', label: 'Algenib · grave' },
  { id: 'Sulafat', label: 'Sulafat · cálida' },
] as const;
export const VOICE_IDS = VOICES.map((v) => v.id) as [string, ...string[]];

export const SAMPLE_TEXT = 'Si sientes que vas tarde, escucha esto. Nunca es tarde para empezar.';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const pad = (n: number): string => String(n).padStart(2, '0');

export interface SceneVoice {
  file: string;
  durationS: number;
  cached: boolean;
}

/** Texto que se envía a la voz: sin emojis ni símbolos que el modelo leería en voz alta o ignoraría. */
export function speechText(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[#*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pide la voz con reintentos pacientes: el plan gratuito limita las peticiones por minuto. */
async function synthesizeWithRetry(text: string, voiceName: string, onWait: (seconds: number) => void): Promise<Buffer> {
  const maxAttempts = 4;
  for (let attempt = 1; ; attempt++) {
    try {
      return await synthesizeSpeech(text, voiceName);
    } catch (err) {
      if (err instanceof AppError && err.code === 'GEMINI_RATE_LIMIT' && attempt < maxAttempts) {
        onWait(Math.round(config.ttsRetryDelayMs / 1000));
        await sleep(config.ttsRetryDelayMs);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Genera (o reutiliza) la voz de una escena. El archivo lleva al lado un .json con la huella del
 * texto, la voz y el modelo: si no cambió nada, no se vuelve a gastar cuota al renderizar de nuevo.
 */
export async function voiceForScene(
  dir: string,
  n: number,
  text: string,
  voiceName: string,
  onWait: (seconds: number) => void = () => {},
): Promise<SceneVoice> {
  const clean = speechText(text);
  const file = path.join(dir, `voz-escena-${pad(n)}.wav`);
  const meta = `${file}.json`;
  const fingerprint = createHash('sha1').update(`${config.geminiTtsModel}|${voiceName}|${clean}`).digest('hex');

  if (fs.existsSync(file) && fs.existsSync(meta)) {
    try {
      if ((JSON.parse(fs.readFileSync(meta, 'utf8')) as { fingerprint?: string }).fingerprint === fingerprint) {
        const info = await probeMedia(file);
        if (info.durationS > 0) return { file, durationS: info.durationS, cached: true };
      }
    } catch {
      // metadatos ilegibles: se regenera
    }
  }

  const wav = await synthesizeWithRetry(clean, voiceName, onWait);
  fs.writeFileSync(file, wav);
  const info = await probeMedia(file);
  if (info.durationS <= 0) {
    fs.rmSync(file, { force: true });
    throw new AppError(502, 'TTS_EMPTY', 'Gemini devolvió un audio que no se pudo leer. Vuelve a intentarlo.');
  }
  fs.writeFileSync(meta, JSON.stringify({ fingerprint, voiceName, model: config.geminiTtsModel, text: clean }));
  return { file, durationS: info.durationS, cached: false };
}
