import { useEffect, useRef, useState } from 'react';
import { api, uploadClip, uploadMusic } from '../api';
import { cn, fmtBytes } from '../lib/format';
import type { AnalysisDTO, CaptionPosition, CaptionPreset, Clip, FormatPreset, Music, Project, RenderOptions, RenderState, ScriptDTO, VoiceOption } from '../types';
import { Button, Field, Select, ToggleChip } from './ui';

const FLOW_HINT = 'Descarga cada clip desde Flow y arrástralo a su escena.';

function ClipSlot({
  projectId,
  scene,
  clip,
  aspect,
  onClip,
  onNotify,
}: {
  projectId: number;
  scene: ScriptDTO['data']['scenes'][number];
  clip: Clip | undefined;
  aspect: '9:16' | '16:9';
  onClip: (n: number, clip: Clip | null) => void;
  onNotify: (message: string, kind: 'ok' | 'error') => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const send = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setProgress(0);
    try {
      onClip(scene.n, await uploadClip(projectId, scene.n, file, setProgress));
    } catch (e) {
      onNotify((e as Error).message, 'error');
    } finally {
      setProgress(null);
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await api.deleteClip(projectId, scene.n);
      onClip(scene.n, null);
    } catch (e) {
      onNotify((e as Error).message, 'error');
    }
  };

  const warnings: string[] = [];
  if (clip) {
    if (clip.durationS < scene.durationS - 1) warnings.push(`Dura ${clip.durationS.toFixed(1)} s y la escena pide ${scene.durationS} s: el último fotograma se alargará.`);
    const portrait = clip.height >= clip.width;
    if (portrait !== (aspect === '9:16')) warnings.push('La orientación no coincide con el formato: se recortará el centro.');
  }

  return (
    <li
      className={cn('flex flex-col gap-2 rounded-xl border p-3 transition-colors', over ? 'border-accent bg-accent-soft/40' : 'border-line')}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void send(e.dataTransfer.files[0]);
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold">Escena {scene.n}</p>
        <p className="text-xs tabular-nums text-ink-soft">{scene.durationS} s</p>
      </div>
      <p className="line-clamp-2 min-h-[2.5rem] text-sm text-ink-soft">{scene.voiceover || scene.onScreenText || scene.visualPrompt}</p>

      {clip ? (
        <div className="flex gap-3">
          <img src={clip.thumbUrl} alt={`Miniatura de la escena ${scene.n}`} className="h-24 w-auto rounded-lg bg-ink/10 object-cover" />
          <div className="min-w-0 text-xs text-ink-soft">
            <p className="truncate font-medium text-ink" title={clip.originalName}>
              {clip.originalName}
            </p>
            <p className="tabular-nums">
              {clip.durationS.toFixed(1)} s · {clip.width}×{clip.height} · {fmtBytes(clip.sizeBytes)}
            </p>
            <p>{clip.hasAudio ? 'Con audio' : 'Sin audio'}</p>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={progress !== null}
          className="flex h-24 items-center justify-center rounded-lg border border-dashed border-ink-soft/50 px-3 text-center text-sm text-ink-soft hover:border-accent hover:text-accent"
        >
          {progress !== null ? `Subiendo… ${Math.round(progress * 100)} %` : 'Arrastra el clip aquí o haz clic para elegirlo'}
        </button>
      )}

      {progress !== null && clip && (
        <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-accent" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {warnings.map((w) => (
        <p key={w} className="text-xs text-warn">
          {w}
        </p>
      ))}

      {clip && (
        <div className="flex gap-1">
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => input.current?.click()} disabled={progress !== null}>
            {progress !== null ? `Subiendo… ${Math.round(progress * 100)} %` : 'Reemplazar'}
          </Button>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={remove} disabled={progress !== null}>
            Quitar
          </Button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="video/*,.mp4,.mov,.m4v,.webm,.mkv"
        className="sr-only"
        aria-label={`Clip de la escena ${scene.n}`}
        onChange={(e) => {
          void send(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </li>
  );
}

const PRESETS: Array<{ id: CaptionPreset; label: string }> = [
  { id: 'classic', label: 'Blanco con borde' },
  { id: 'yellow', label: 'Amarillo' },
  { id: 'boxed', label: 'Con caja' },
];
const POSITIONS: Array<{ id: CaptionPosition; label: string }> = [
  { id: 'bottom', label: 'Abajo' },
  { id: 'center', label: 'Centro' },
  { id: 'top', label: 'Arriba' },
];

export function VideoPanel({
  project,
  formats,
  script,
  analysis,
  clips,
  music,
  render,
  voices,
  aiConfigured,
  onClips,
  onMusic,
  onRender,
  onNotify,
}: {
  project: Project;
  formats: FormatPreset[];
  script: ScriptDTO | null;
  analysis: AnalysisDTO | null;
  clips: Clip[];
  music: Music | null;
  render: RenderState;
  voices: VoiceOption[];
  aiConfigured: boolean;
  onClips: (update: (clips: Clip[]) => Clip[]) => void;
  onMusic: (music: Music | null) => void;
  onRender: (render: RenderState) => void;
  onNotify: (message: string, kind: 'ok' | 'error') => void;
}) {
  const detected = analysis?.data.styleProfile.captions;
  const projectFormats = formats.filter((f) => project.platforms.includes(f.id));
  const [voiceMode, setVoiceMode] = useState<'gemini' | 'none'>(aiConfigured ? 'gemini' : 'none');
  const [voiceName, setVoiceName] = useState('Kore');
  const [pace, setPace] = useState(1);
  const [captions, setCaptions] = useState(true);
  const [preset, setPreset] = useState<CaptionPreset>(detected?.preset ?? 'classic');
  const [position, setPosition] = useState<CaptionPosition>(detected?.position ?? 'bottom');
  const [uppercase, setUppercase] = useState(detected?.uppercase ?? true);
  const [useMusic, setUseMusic] = useState(false);
  const [keepAudio, setKeepAudio] = useState(true);
  const [selected, setSelected] = useState<string[]>(projectFormats.map((f) => f.id));
  const [musicProgress, setMusicProgress] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [sampling, setSampling] = useState(false);
  const musicInput = useRef<HTMLInputElement>(null);

  // Si el análisis llega o cambia, los subtítulos vuelven a partir del estilo detectado.
  const analysisStamp = analysis?.createdAt;
  useEffect(() => {
    const d = analysis?.data.styleProfile.captions;
    if (!d) return;
    setPreset(d.preset);
    setPosition(d.position);
    setUppercase(d.uppercase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisStamp]);

  // Mientras se edita, se consulta el avance cada segundo y medio.
  const running = render.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      api
        .render(project.id)
        .then(onRender)
        .catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [running, project.id, onRender]);

  if (!script) {
    return (
      <section aria-labelledby="video-title" className="rounded-2xl border border-line bg-card p-5 sm:p-6">
        <h2 id="video-title" className="font-display text-4xl leading-tight">
          Clips y video final
        </h2>
        <p className="mt-2 text-ink-soft">Genera el guion primero: cada clip de Flow se asocia a una escena.</p>
      </section>
    );
  }

  const byScene = new Map(clips.map((c) => [c.n, c]));
  const missing = script.data.scenes.filter((s) => !byScene.has(s.n)).length;
  const setClip = (n: number, clip: Clip | null): void =>
    onClips((cur) => (clip ? [...cur.filter((c) => c.n !== n), clip].sort((a, b) => a.n - b.n) : cur.filter((c) => c.n !== n)));

  const canStart = missing === 0 && selected.length > 0 && !running && !starting && (voiceMode === 'none' || aiConfigured) && (!useMusic || music != null);

  const start = async (): Promise<void> => {
    setStarting(true);
    const options: Partial<RenderOptions> = {
      voice: { mode: voiceMode, voiceName, pace },
      captions: { enabled: captions, preset, position, uppercase },
      music: useMusic,
      keepClipAudio: keepAudio,
      formatIds: selected,
    };
    try {
      onRender(await api.startRender(project.id, options));
    } catch (e) {
      onNotify((e as Error).message, 'error');
    } finally {
      setStarting(false);
    }
  };

  const playSample = async (): Promise<void> => {
    setSampling(true);
    try {
      const res = await fetch('/api/ai/voice-sample', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voiceName }) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? 'No se pudo generar la muestra.');
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (e) {
      onNotify((e as Error).message, 'error');
    } finally {
      setSampling(false);
    }
  };

  const sendMusic = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setMusicProgress(0);
    try {
      onMusic(await uploadMusic(project.id, file, setMusicProgress));
      setUseMusic(true);
    } catch (e) {
      onNotify((e as Error).message, 'error');
    } finally {
      setMusicProgress(null);
    }
  };

  return (
    <section aria-labelledby="video-title" className="space-y-6 rounded-2xl border border-line bg-card p-5 sm:p-6">
      <div>
        <h2 id="video-title" className="font-display text-4xl leading-tight">
          Clips y video final
        </h2>
        <p className="mt-1 max-w-3xl text-ink-soft">
          {FLOW_HINT} La app pone la voz en off, los subtítulos y la música, y entrega un mp4 por plataforma.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {script.data.scenes.map((scene) => (
          <ClipSlot key={scene.n} projectId={project.id} scene={scene} clip={byScene.get(scene.n)} aspect={script.params.aspect} onClip={setClip} onNotify={onNotify} />
        ))}
      </ul>
      <p className="text-sm text-ink-soft" role="status">
        {missing === 0 ? 'Todos los clips están subidos.' : `Faltan ${missing} ${missing === 1 ? 'clip' : 'clips'}.`}
      </p>

      <div className="grid gap-6 border-t border-line pt-5 lg:grid-cols-2">
        <fieldset className="space-y-3">
          <legend className="font-semibold">Voz en off</legend>
          <div className="flex flex-wrap gap-2">
            <ToggleChip checked={voiceMode === 'gemini'} onChange={(c) => setVoiceMode(c ? 'gemini' : 'none')}>
              Voz de Gemini
            </ToggleChip>
          </div>
          {voiceMode === 'gemini' && (
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label="Voz">
                <Select value={voiceName} onChange={(e) => setVoiceName(e.target.value)}>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button onClick={playSample} disabled={sampling || !aiConfigured}>
                {sampling ? 'Generando…' : 'Probar voz'}
              </Button>
              <Field label={`Velocidad: ${pace.toFixed(2)}×`} hint="Más rápido acorta las pausas entre frases.">
                <input type="range" min={0.8} max={1.3} step={0.05} value={pace} onChange={(e) => setPace(Number(e.target.value))} className="accent-accent" />
              </Field>
            </div>
          )}
          {voiceMode === 'gemini' && !aiConfigured && <p className="text-sm text-warn">Falta la GEMINI_API_KEY para generar la voz.</p>}
          {voiceMode === 'none' && <p className="text-sm text-ink-soft">Sin voz, cada escena dura lo que dura su clip. Los subtítulos no tendrán texto que mostrar.</p>}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-semibold">Subtítulos</legend>
          <ToggleChip checked={captions} onChange={setCaptions}>
            Quemar subtítulos en el video
          </ToggleChip>
          {captions && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Estilo">
                <Select value={preset} onChange={(e) => setPreset(e.target.value as CaptionPreset)}>
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Posición">
                <Select value={position} onChange={(e) => setPosition(e.target.value as CaptionPosition)}>
                  {POSITIONS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <ToggleChip checked={uppercase} onChange={setUppercase}>
                En mayúsculas
              </ToggleChip>
              {detected?.present && <p className="text-xs text-ink-soft sm:col-span-2">Preseleccionado según los subtítulos del video de referencia.</p>}
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-semibold">Sonido</legend>
          <ToggleChip checked={keepAudio} onChange={setKeepAudio}>
            Conservar el sonido ambiente de los clips
          </ToggleChip>
          <div className="space-y-2">
            <ToggleChip checked={useMusic} onChange={setUseMusic}>
              Música de fondo
            </ToggleChip>
            {useMusic && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {music && (
                  <p className="text-ink-soft">
                    {music.originalName} · {music.durationS.toFixed(0)} s
                  </p>
                )}
                <Button onClick={() => musicInput.current?.click()} disabled={musicProgress !== null}>
                  {musicProgress !== null ? `Subiendo… ${Math.round(musicProgress * 100)} %` : music ? 'Cambiar pista' : 'Subir pista (mp3, wav, m4a)'}
                </Button>
                {music && (
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      await api.deleteMusic(project.id).catch((e: Error) => onNotify(e.message, 'error'));
                      onMusic(null);
                      setUseMusic(false);
                    }}
                  >
                    Quitar
                  </Button>
                )}
                <input ref={musicInput} type="file" accept="audio/*" className="sr-only" aria-label="Pista de música" onChange={(e) => { void sendMusic(e.target.files?.[0]); e.target.value = ''; }} />
              </div>
            )}
            {script.data.musicSuggestion && useMusic && <p className="text-xs text-ink-soft">Sugerencia: {script.data.musicSuggestion}</p>}
            <p className="text-xs text-ink-soft">Usa música con licencia para publicar: la app no incluye pistas.</p>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-semibold">Formatos de salida</legend>
          <ul className="flex flex-wrap gap-2">
            {projectFormats.map((f) => (
              <li key={f.id}>
                <ToggleChip checked={selected.includes(f.id)} onChange={(c) => setSelected((cur) => (c ? [...cur, f.id] : cur.filter((x) => x !== f.id)))}>
                  {f.label} · {f.width}×{f.height}
                </ToggleChip>
              </li>
            ))}
          </ul>
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <Button variant="primary" onClick={start} disabled={!canStart}>
          {running ? 'Generando…' : render.status === 'done' ? 'Generar de nuevo' : 'Generar video'}
        </Button>
        {running && <Button onClick={() => api.cancelRender(project.id).catch((e: Error) => onNotify(e.message, 'error'))}>Cancelar</Button>}
        {!canStart && !running && (
          <p className="text-sm text-ink-soft">
            {missing > 0 ? 'Sube todos los clips para continuar.' : selected.length === 0 ? 'Elige al menos un formato.' : useMusic && !music ? 'Sube la pista de música o desactívala.' : ''}
          </p>
        )}
      </div>

      {running && (
        <div role="status" className="space-y-2 rounded-xl bg-accent-soft/50 p-4">
          <p className="font-medium">{render.step || 'Preparando'}</p>
          <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(render.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(render.progress * 100, 3)}%` }} />
          </div>
          <p className="text-xs text-ink-soft">Puedes salir de esta pantalla: el video se sigue generando en el servidor.</p>
        </div>
      )}
      {(render.status === 'error' || render.status === 'cancelled') && render.error && (
        <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {render.error}
        </p>
      )}

      {render.status === 'done' && render.outputs.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-semibold">Videos listos</h3>
          <ul className="grid gap-5 md:grid-cols-2">
            {render.outputs.map((o) => (
              <li key={o.formatId} className="space-y-2">
                <video
                  controls
                  preload="metadata"
                  src={`${o.url}?v=${render.finishedAt ?? ''}`}
                  className={cn('w-full rounded-xl bg-black', o.height > o.width ? 'max-h-[32rem] object-contain' : 'aspect-video')}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-ink-soft">
                    <span className="font-semibold text-ink">{o.label}</span> · {o.width}×{o.height} · {o.durationS.toFixed(1)} s · {fmtBytes(o.sizeBytes)}
                  </p>
                  <a href={`${o.url}?download=1`} className="rounded-lg bg-inverse px-3.5 py-2 text-sm font-semibold text-on-inverse hover:bg-white">
                    Descargar mp4
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
