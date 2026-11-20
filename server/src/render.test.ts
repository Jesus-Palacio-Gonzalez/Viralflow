/**
 * Edición con FFmpeg real y voz simulada: clips sintéticos → mp4 final por formato.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viralflow-render-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.WORKSPACE_DIR = path.join(tmp, 'workspace');
process.env.GEMINI_API_KEY = 'clave-gemini-prueba';
process.env.GEMINI_RETRY_DELAY_MS = '1';
process.env.TTS_RETRY_DELAY_MS = '1';

const ttsCalls: string[] = [];
let ttsMode: 'ok' | 'ratelimit-once' = 'ok';
let rateLimited = false;
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const { ffmpegPath, probeMedia } = await import('./media.js');
const FFMPEG = await ffmpegPath();
const ff = (args: string[]): void => void execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

// 1,5 s de tono a 24 kHz s16le mono: lo que devuelve Gemini TTS.
const pcm = path.join(tmp, 'tono.pcm');
ff(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=1.5:sample_rate=24000', '-f', 's16le', '-ac', '1', pcm]);
const pcmB64 = fs.readFileSync(pcm).toString('base64');

globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = String(input);
  const body = JSON.parse(String(init?.body ?? '{}'));
  if (body.generationConfig?.responseModalities) {
    ttsCalls.push(url);
    if (ttsMode === 'ratelimit-once' && !rateLimited) {
      rateLimited = true;
      return json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } }, 429);
    }
    return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcmB64 } }] } }] });
  }
  const scenes = [0, 1, 2].map((i) => ({
    durationS: 5,
    voiceover: `Texto corto de la escena número ${i + 1} para probar`,
    onScreenText: `Idea ${i + 1}`,
    visualPrompt: `A lone runner crosses a bridge at dawn, shot ${i + 1}`,
    audioPrompt: '',
  }));
  const script = { title: 'Prueba', concept: 'c', language: 'es', hook: 'h', styleBible: 'Cinematic', scenes, caption: 'x', hashtags: ['a'], musicSuggestion: '' };
  return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(script) }] }, finishReason: 'STOP' }] });
}) as typeof fetch;

const { generateProjectScript } = await import('./content.js');
const { createProject } = await import('./projects.js');
const { saveClip, saveMusic, listClips } = await import('./clips.js');
const { startRender, getRenderState, planScene, buildSegmentArgs, resolveOptions } = await import('./render.js');

const upload = (file: string) => Object.assign(fs.createReadStream(file), { headers: {} as Record<string, string> });
const waitDone = async (id: number) => {
  for (let i = 0; i < 600; i++) {
    const s = getRenderState(id);
    if (s.status !== 'running') return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('el render no terminó');
};
const frameHash = (video: string, at: number): string => {
  const out = path.join(tmp, `frame-${Math.random().toString(36).slice(2)}.png`);
  ff(['-ss', String(at), '-i', video, '-frames:v', '1', out]);
  return createHash('md5').update(fs.readFileSync(out)).digest('hex');
};

test('planScene: la voz manda, sin voz manda el clip, y acelera si habría que congelar demasiado', () => {
  assert.deepEqual(planScene({ plannedS: 5, clipS: 5, voiceS: 3, pace: 1 }), { durationS: 3.35, voiceTempo: 1 });
  assert.equal(planScene({ plannedS: 5, clipS: 4, voiceS: null, pace: 1 }).durationS, 4);
  assert.equal(planScene({ plannedS: 3, clipS: 8, voiceS: null, pace: 1 }).durationS, 3);
  const fast = planScene({ plannedS: 5, clipS: 3, voiceS: 6, pace: 1 });
  assert.ok(fast.voiceTempo > 1 && fast.voiceTempo <= 1.25);
});

test('resolveOptions rechaza formatos que no son del proyecto', () => {
  const p = createProject({ name: 'Opciones', platforms: ['tiktok'] });
  assert.throws(() => resolveOptions({ formatIds: ['youtube-long'] }, p, null), /formato/i);
  assert.equal(resolveOptions({}, p, { preset: 'yellow', uppercase: false }).captions.preset, 'yellow');
});

test('buildSegmentArgs: subtítulos solo si hay archivo .ass y silencio si no hay audio', () => {
  const base = { clip: 'a.mp4', clipHasAudio: false, voice: null, keepClipAudio: true, width: 1080, height: 1920, fps: 30, durationS: 3, voiceTempo: 1, out: 's.mp4' };
  const plain = buildSegmentArgs({ ...base, ass: null }).join(' ');
  assert.ok(!plain.includes('subtitles=') && plain.includes('anullsrc'));
  assert.ok(buildSegmentArgs({ ...base, ass: 'e.ass' }).join(' ').includes('subtitles=e.ass:fontsdir=fonts'));
});

const project = createProject({ name: 'Render real', platforms: ['tiktok', 'youtube-long'] });
const clipsDir = path.join(tmp, 'clips-src');
fs.mkdirSync(clipsDir);

test('rechaza renderizar sin guion o con clips faltantes', async () => {
  await assert.rejects(startRender(project.id, {}), /guion/i);
  await generateProjectScript(project.id, { language: 'es', targetSeconds: 15, promptLanguage: 'en' });
  await assert.rejects(startRender(project.id, {}), /Faltan/);
});

test('sube clips (uno corto, uno sin audio) y valida que sean video', async () => {
  const mk = (name: string, dur: number, audio: boolean, size = '720x1280') =>
    ff(['-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=24:duration=${dur}`, ...(audio ? ['-f', 'lavfi', '-i', `sine=frequency=220:duration=${dur}`, '-c:a', 'aac'] : ['-an']), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(clipsDir, name)]);
  mk('1.mp4', 3, true);
  mk('2.mp4', 1, true);
  mk('3.mp4', 2, false, '1280x720'); // horizontal: se recorta al vertical
  for (const n of [1, 2, 3]) await saveClip(project.id, n, upload(path.join(clipsDir, `${n}.mp4`)), `${n}.mp4`);
  const clips = listClips(project.id);
  assert.equal(clips.length, 3);
  assert.equal(clips[2]!.hasAudio, false);
  fs.writeFileSync(path.join(clipsDir, 'texto.mp4'), 'esto no es un video');
  await assert.rejects(saveClip(project.id, 1, upload(path.join(clipsDir, 'texto.mp4')), 'texto.mp4'));
  assert.equal(listClips(project.id)[0]!.durationS > 2.5, true); // el clip bueno sigue intacto
});

test('genera un mp4 por formato con voz, subtítulos y duración esperada; reutiliza la voz', async () => {
  ttsMode = 'ratelimit-once';
  await startRender(project.id, { formatIds: ['tiktok', 'youtube-long'], captions: { enabled: true, uppercase: true } });
  const state = await waitDone(project.id);
  assert.equal(state.status, 'done', state.error ?? '');
  assert.equal(state.outputs.length, 2);
  assert.equal(ttsCalls.length, 4); // 3 escenas + 1 reintento tras el límite

  const [tiktok, wide] = state.outputs;
  assert.deepEqual([tiktok!.width, tiktok!.height], [1080, 1920]);
  assert.deepEqual([wide!.width, wide!.height], [1920, 1080]);
  assert.ok(Math.abs(tiktok!.durationS - 3 * 1.85) < 0.5, `duración ${tiktok!.durationS}`);
  const info = await probeMedia(path.join(project.folder, '07-exportados', 'tiktok', tiktok!.fileName));
  assert.ok(info.hasVideo && info.hasAudio);
  assert.ok(!fs.existsSync(path.join(project.folder, '.render')));

  // Segunda pasada sin subtítulos: la voz sale de la caché y los fotogramas cambian.
  const withCaptions = frameHash(path.join(project.folder, '07-exportados', 'tiktok', tiktok!.fileName), 0.6);
  ttsCalls.length = 0;
  await startRender(project.id, { formatIds: ['tiktok'], captions: { enabled: false } });
  const second = await waitDone(project.id);
  assert.equal(second.status, 'done', second.error ?? '');
  assert.equal(ttsCalls.length, 0);
  assert.notEqual(frameHash(path.join(project.folder, '07-exportados', 'tiktok', second.outputs[0]!.fileName), 0.6), withCaptions);
});

test('mezcla música de fondo y mantiene la duración', async () => {
  const music = path.join(clipsDir, 'musica.mp3');
  ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', 'libmp3lame', music]); // más corta que el video: se repite
  await saveMusic(project.id, upload(music), 'musica.mp3');
  await startRender(project.id, { formatIds: ['tiktok'], music: true, voice: { mode: 'none' } });
  const state = await waitDone(project.id);
  assert.equal(state.status, 'done', state.error ?? '');
  const out = state.outputs[0]!;
  const info = await probeMedia(path.join(project.folder, '07-exportados', 'tiktok', out.fileName));
  assert.ok(info.hasAudio);
  assert.ok(Math.abs(info.durationS - out.durationS) < 0.3);
});

test('se puede cancelar y solo se permite un render a la vez', async () => {
  const { cancelRender } = await import('./render.js');
  await startRender(project.id, { formatIds: ['tiktok', 'youtube-long'], voice: { mode: 'none' } });
  await assert.rejects(startRender(project.id, { voice: { mode: 'none' } }), /Ya se está generando/);
  cancelRender(project.id);
  const state = await waitDone(project.id);
  assert.ok(['cancelled', 'done'].includes(state.status));
});
