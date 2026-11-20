import type { ZodType } from 'zod';
import { config } from './config.js';
import { AppError } from './errors.js';

export type Part = { text: string } | { file_data: { file_uri: string } };

export interface GenerateOptions {
  parts: Part[];
  temperature?: number;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

/** Si la API rechaza `responseMimeType`, se desactiva y se sigue pidiendo JSON solo en el prompt. */
let jsonModeSupported = true;
export const resetGeminiState = (): void => {
  jsonModeSupported = true;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function mapError(status: number, body: any, model: string = config.geminiModel): AppError {
  const err = body?.error ?? {};
  const message = String(err.message ?? `HTTP ${status}`);
  const code = String(err.status ?? '');

  if (/API key not valid|API_KEY_INVALID|API key expired/i.test(message) || /API_KEY_INVALID/.test(JSON.stringify(err.details ?? ''))) {
    return new AppError(
      400,
      'BAD_GEMINI_KEY',
      'La GEMINI_API_KEY no es válida. Genera una en https://aistudio.google.com/apikey y actualiza el archivo .env.',
    );
  }
  if (status === 429 || code === 'RESOURCE_EXHAUSTED') {
    return new AppError(
      429,
      'GEMINI_RATE_LIMIT',
      'Gemini alcanzó el límite del plan gratuito (por minuto o por día). Espera un minuto y vuelve a intentar; si sigue igual, la cuota de hoy ya se agotó.',
    );
  }
  if (code === 'FAILED_PRECONDITION' || /location is not supported/i.test(message)) {
    return new AppError(400, 'GEMINI_REGION', 'Gemini no está disponible para tu país o plan. Revisa la disponibilidad regional en la documentación de Gemini API.');
  }
  if (status === 403 || code === 'PERMISSION_DENIED') {
    return new AppError(
      403,
      'GEMINI_FORBIDDEN',
      'Gemini rechazó la clave (permiso denegado). Verifica que la API esté habilitada para tu proyecto y que la clave no tenga restricciones.',
    );
  }
  if (status === 404 || code === 'NOT_FOUND') {
    return new AppError(
      404,
      'GEMINI_MODEL',
      `El modelo «${model}» no existe o no está disponible para tu clave. Cambia ${model === config.geminiTtsModel ? 'GEMINI_TTS_MODEL' : 'GEMINI_MODEL'} en el archivo .env (en AI Studio ves los modelos que puedes usar).`,
    );
  }
  if (status >= 500 || code === 'UNAVAILABLE' || code === 'INTERNAL' || code === 'DEADLINE_EXCEEDED') {
    return new AppError(503, 'GEMINI_BUSY', 'Gemini está saturado en este momento. Vuelve a intentar en unos segundos.');
  }
  return new AppError(400, 'GEMINI_BAD_REQUEST', `Gemini no pudo procesar la solicitud: ${message.slice(0, 300)}`);
}

const blocked = (): AppError =>
  new AppError(422, 'GEMINI_BLOCKED', 'Gemini bloqueó la respuesta por sus filtros de seguridad. Cambia el tema o prueba con otro video.');

function readText(body: any): string {
  if (body?.promptFeedback?.blockReason) throw blocked();
  const candidate = body?.candidates?.[0];
  if (candidate?.finishReason && /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/.test(String(candidate.finishReason))) throw blocked();
  const parts: unknown = candidate?.content?.parts;
  const text = Array.isArray(parts)
    ? parts
        .filter((p: any) => typeof p?.text === 'string' && !p.thought)
        .map((p: any) => p.text as string)
        .join('')
    : '';
  if (!text.trim()) throw new AppError(502, 'GEMINI_EMPTY', 'Gemini no devolvió texto. Vuelve a intentarlo.');
  return text;
}

/** Llama a generateContent de un modelo y devuelve el cuerpo ya interpretado (la clave va en un encabezado). */
async function request(model: string, body: unknown, timeoutMs: number): Promise<any> {
  if (!config.geminiApiKey) {
    throw new AppError(400, 'NO_GEMINI_KEY', 'Falta GEMINI_API_KEY. Créala en https://aistudio.google.com/apikey, agrégala al archivo .env y reinicia el servidor.');
  }
  const url = `${config.geminiBaseUrl}/models/${encodeURIComponent(model)}:generateContent`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      // La clave va en un encabezado, nunca en la URL, para que no aparezca en errores ni registros.
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') {
      throw new AppError(504, 'GEMINI_TIMEOUT', 'Gemini tardó demasiado en responder. Vuelve a intentar; los videos largos pueden demorar más.');
    }
    throw new AppError(502, 'NETWORK', `No se pudo contactar a Gemini (${(err as Error).name}). Revisa tu conexión.`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw mapError(res.status, data, model);
  return data;
}

async function post(opts: GenerateOptions, json: boolean): Promise<string> {
  const body = {
    contents: [{ role: 'user', parts: opts.parts }],
    generationConfig: {
      temperature: opts.temperature ?? 0.8,
      maxOutputTokens: opts.maxOutputTokens ?? 16_384,
      ...(json && jsonModeSupported ? { responseMimeType: 'application/json' } : {}),
    },
  };
  return readText(await request(config.geminiModel, body, opts.timeoutMs ?? 120_000));
}

async function callText(opts: GenerateOptions, json: boolean): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await post(opts, json);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      if (json && jsonModeSupported && err.code === 'GEMINI_BAD_REQUEST' && /response_?mime_?type|unknown name|cannot find field/i.test(err.message)) {
        jsonModeSupported = false;
        continue;
      }
      if (err.code === 'GEMINI_BUSY' && attempt < 1) {
        await sleep(config.geminiRetryDelayMs);
        continue;
      }
      throw err;
    }
  }
}

/** Extrae un objeto JSON aunque venga envuelto en ```json o con texto alrededor. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('sin objeto JSON');
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Pide JSON, lo valida con el esquema y reintenta una vez si viene roto o incompleto. */
export async function generateJson<T>(opts: GenerateOptions, schema: ZodType<T>): Promise<{ data: T; model: string }> {
  let lastReason = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await callText(opts, true);
    try {
      return { data: schema.parse(extractJson(text)), model: config.geminiModel };
    } catch (err) {
      lastReason = (err as Error).message.slice(0, 200);
    }
  }
  console.error(`Gemini devolvió una respuesta inválida dos veces: ${lastReason}`);
  throw new AppError(502, 'GEMINI_BAD_OUTPUT', 'Gemini devolvió una respuesta que no se pudo leer. Vuelve a intentarlo.');
}

export async function pingGemini(): Promise<{ ok: true; model: string; reply: string }> {
  const reply = await callText({ parts: [{ text: 'Responde únicamente con la palabra: ok' }], temperature: 0, maxOutputTokens: 64, timeoutMs: 30_000 }, false);
  return { ok: true, model: config.geminiModel, reply: reply.trim().slice(0, 40) };
}

/** Envuelve audio PCM de 16 bits mono en un contenedor WAV. */
export function pcmToWav(pcm: Buffer, sampleRate = 24_000): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Convierte texto en voz con un modelo TTS de Gemini y devuelve un WAV.
 * Según el modelo, la respuesta llega como WAV completo o como PCM crudo (24 kHz, 16 bits, mono):
 * se aceptan ambos.
 */
export async function synthesizeSpeech(text: string, voiceName: string): Promise<Buffer> {
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
  };
  let data: any;
  for (let attempt = 0; ; attempt++) {
    try {
      data = await request(config.geminiTtsModel, body, 90_000);
      break;
    } catch (err) {
      if (err instanceof AppError && err.code === 'GEMINI_BUSY' && attempt < 1) {
        await sleep(config.geminiRetryDelayMs);
        continue;
      }
      throw err;
    }
  }
  if (data?.promptFeedback?.blockReason) throw blocked();
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  const inline = parts.map((p) => p?.inlineData ?? p?.inline_data).find((d) => typeof d?.data === 'string');
  if (!inline) throw new AppError(502, 'TTS_EMPTY', 'Gemini no devolvió audio. Prueba con otra voz o revisa GEMINI_TTS_MODEL en el archivo .env.');
  const audio = Buffer.from(inline.data as string, 'base64');
  if (audio.length < 100) throw new AppError(502, 'TTS_EMPTY', 'Gemini devolvió un audio vacío. Vuelve a intentarlo.');
  if (audio.subarray(0, 4).toString('latin1') === 'RIFF') return audio;
  const rate = Number(/rate=(\d+)/.exec(String(inline.mimeType ?? inline.mime_type ?? ''))?.[1]) || 24_000;
  return pcmToWav(audio, rate);
}
