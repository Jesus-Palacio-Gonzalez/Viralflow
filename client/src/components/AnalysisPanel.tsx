import { useState } from 'react';
import { api } from '../api';
import { cn } from '../lib/format';
import type { AnalysisDTO, AnalysisMode, Project } from '../types';
import { Button, HEAT_GRADIENT } from './ui';

const MODES: Array<{ id: AnalysisMode; title: string; help: string }> = [
  {
    id: 'video',
    title: 'Que Gemini vea el video (recomendado)',
    help: 'Detecta ritmo, planos, voz y transcripción. Solo funciona con videos públicos de YouTube.',
  },
  {
    id: 'metadata',
    title: 'Solo título y descripción',
    help: 'Más rápido y no depende del video, pero deduce el estilo sin verlo y no transcribe.',
  },
];

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item} className="rounded-md bg-ink/5 px-2 py-0.5 text-xs text-ink-soft">
          {item}
        </li>
      ))}
    </ul>
  );
}

function Detail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold">{title}</h4>
      <div className="text-sm leading-relaxed text-ink-soft">{children}</div>
    </div>
  );
}

function Timeline({ analysis }: { analysis: AnalysisDTO['data'] }) {
  const total = Math.max(1, ...analysis.structure.map((b) => b.endS));
  return (
    <ol className="space-y-3">
      {analysis.structure.map((beat, i) => {
        const left = (Math.min(beat.startS, total) / total) * 100;
        const width = Math.max(((beat.endS - beat.startS) / total) * 100, 3);
        return (
          <li key={`${beat.startS}-${i}`} className="grid gap-x-4 gap-y-1 sm:grid-cols-[9rem_1fr]">
            <div>
              <p className="font-semibold leading-tight">{beat.label}</p>
              <p className="text-xs tabular-nums text-ink-soft">
                {beat.startS}–{beat.endS} s
              </p>
            </div>
            <div>
              <div className="h-2.5 overflow-hidden rounded-full bg-line/70" aria-hidden="true">
                <div
                  className="h-full rounded-full"
                  style={{
                    marginLeft: `${Math.min(left, 100 - width)}%`,
                    width: `${width}%`,
                    // El gancho es el tramo "caliente"; el resto va en índigo.
                    background: i === 0 ? HEAT_GRADIENT : 'var(--color-accent)',
                  }}
                />
              </div>
              <p className="mt-1.5 text-sm text-ink-soft">{beat.description}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function AnalysisPanel({
  project,
  analysis,
  aiConfigured,
  onDone,
}: {
  project: Project;
  analysis: AnalysisDTO | null;
  aiConfigured: boolean;
  onDone: (analysis: AnalysisDTO) => void;
}) {
  const isDemo = project.reference?.source === 'demo';
  const [mode, setMode] = useState<AnalysisMode>(isDemo ? 'metadata' : 'video');
  const [showForm, setShowForm] = useState(analysis == null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      onDone(await api.analyze(project.id, mode));
      setShowForm(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const noReference = project.reference == null;
  const d = analysis?.data;

  return (
    <section aria-labelledby="analysis-title" className="space-y-5 rounded-2xl border border-line bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="analysis-title" className="font-display text-4xl leading-tight">
            Análisis del video de referencia
          </h2>
          {analysis && (
            <p className="mt-1 text-sm text-ink-soft">
              {analysis.mode === 'video' ? 'Gemini vio el video' : 'Solo con título y descripción'} · {analysis.model} ·{' '}
              {new Date(analysis.createdAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          )}
        </div>
        {analysis && !showForm && (
          <Button variant="ghost" onClick={() => setShowForm(true)}>
            Volver a analizar
          </Button>
        )}
      </div>

      {noReference && (
        <p className="rounded-xl bg-caution px-4 py-3 text-sm text-warn">
          Este proyecto no tiene video de referencia. Puedes saltar directo al guion, pero sin análisis la IA usa una estructura genérica.
        </p>
      )}

      {showForm && !noReference && (
        <div className="space-y-4">
          {!analysis && (
            <p className="max-w-2xl text-ink-soft">
              La IA estudia por qué funciona el video: cómo abre, cómo avanza, el ritmo, el estilo visual y el audio. Con eso resume una fórmula que
              puedes replicar con contenido propio.
            </p>
          )}
          <fieldset disabled={running}>
            <legend className="sr-only">Cómo analizar el video</legend>
            <ul className="grid gap-2 sm:grid-cols-2">
              {MODES.map((m) => {
                const blocked = m.id === 'video' && isDemo;
                return (
                  <li key={m.id}>
                    <label
                      className={cn(
                        'flex h-full items-start gap-3 rounded-xl border p-3 transition-colors',
                        blocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                        mode === m.id && !blocked ? 'border-accent bg-accent-soft/50' : 'border-line hover:border-ink-soft',
                      )}
                    >
                      <input
                        type="radio"
                        name="analysis-mode"
                        checked={mode === m.id}
                        disabled={blocked}
                        onChange={() => setMode(m.id)}
                        className="mt-1 accent-accent"
                      />
                      <span>
                        <span className="block font-semibold">{m.title}</span>
                        <span className="block text-sm text-ink-soft">{blocked ? 'Los videos de demo no existen en YouTube, así que Gemini no puede verlos.' : m.help}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={run} disabled={running || !aiConfigured}>
              {running ? 'Analizando…' : analysis ? 'Analizar de nuevo' : 'Analizar video'}
            </Button>
            {analysis && !running && (
              <Button variant="ghost" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
            )}
            {running && (
              <p role="status" className="text-sm text-ink-soft">
                {mode === 'video' ? 'Gemini está viendo el video. Puede tardar hasta un minuto.' : 'Analizando los datos del video.'}
              </p>
            )}
          </div>
          {!aiConfigured && <p className="text-sm text-warn">Falta la GEMINI_API_KEY: sin ella no se puede analizar.</p>}
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {d && !showForm && (
        <div className="space-y-6">
          <p className="max-w-3xl text-lg leading-relaxed">{d.summary}</p>

          <div className="rounded-2xl bg-inverse px-5 py-5 text-on-inverse">
            <p className="text-sm text-on-inverse/70">La fórmula para replicar</p>
            <p className="mt-1 font-display text-3xl leading-snug">{d.formula || '—'}</p>
          </div>

          <div className="space-y-4 rounded-2xl border-2 border-[#ff3d6e]/40 p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-3xl leading-tight">El gancho</h3>
              {d.hookDetail.technique || d.hook.technique ? (
                <p className="text-sm font-medium text-ink-soft">
                  {d.hookDetail.technique || d.hook.technique}
                  {(d.hookDetail.seconds || d.hook.seconds) > 0 && ` · primeros ${d.hookDetail.seconds || d.hook.seconds} s`}
                </p>
              ) : null}
            </div>
            <blockquote className="border-l-4 border-[#ff3d6e] pl-4">
              <p className="text-xl leading-snug">{d.hookDetail.spoken || d.hook.text || '—'}</p>
            </blockquote>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {[
                ['Lo que se ve', d.hookDetail.visual],
                ['Texto en pantalla', d.hookDetail.onScreenText],
                ['Sonido', d.hookDetail.audio],
                ['Qué rompe el scroll', d.hookDetail.patternInterrupt],
                ['Por qué detiene al espectador', d.hookDetail.whyItStops],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="font-semibold">{k}</dt>
                    <dd className="text-ink-soft">{v}</dd>
                  </div>
                ))}
            </dl>
            {d.hookDetail.template && (
              <p className="rounded-xl bg-[#ff3d6e]/10 px-4 py-3 text-sm">
                <span className="font-semibold">Plantilla para reutilizarlo: </span>
                {d.hookDetail.template}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold">Por qué funciona</h3>
            <ul className="list-disc space-y-1 pl-5 text-ink-soft marker:text-accent">
              {d.whyItWorks.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-3 font-semibold">Estructura</h3>
            <Timeline analysis={d} />
          </div>

          <div className="grid gap-5 border-t border-line pt-5 sm:grid-cols-3">
            <Detail title="Ritmo">{d.pacing || '—'}</Detail>
            <Detail title="Estilo visual">
              {d.visualStyle.description || '—'}
              <Chips items={d.visualStyle.shotTypes} />
              <Chips items={d.visualStyle.palette} />
              {d.visualStyle.textOnScreen && <p className="mt-2">Textos: {d.visualStyle.textOnScreen}</p>}
            </Detail>
            <Detail title="Audio">
              <p>Voz: {d.audio.voice || '—'}</p>
              <p>Música: {d.audio.music || '—'}</p>
              <p>Efectos: {d.audio.soundEffects || '—'}</p>
            </Detail>
          </div>

          {(d.styleProfile.look || d.styleProfile.camera || d.styleProfile.editing.cuts) && (
            <details className="rounded-xl border border-line p-3">
              <summary className="cursor-pointer font-medium">Perfil de estilo que se copiará</summary>
              <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                {[
                  ['Aspecto', d.styleProfile.look],
                  ['Color', d.styleProfile.colorGrading],
                  ['Cámara', d.styleProfile.camera],
                  ['Luz', d.styleProfile.lighting],
                  ['Ambiente', d.styleProfile.setting],
                  ['Cortes', [d.styleProfile.editing.cuts, d.styleProfile.editing.avgShotLengthS ? `(plano medio ${d.styleProfile.editing.avgShotLengthS} s)` : ''].filter(Boolean).join(' ')],
                  ['Transiciones y efectos', [d.styleProfile.editing.transitions, d.styleProfile.editing.effects].filter(Boolean).join('. ')],
                  ['Subtítulos', d.styleProfile.captions.present ? d.styleProfile.captions.description || 'Sí lleva' : 'No lleva'],
                  ['Voz', [d.styleProfile.voice.description, d.styleProfile.voice.pace].filter(Boolean).join(' · ')],
                  ['Música', d.styleProfile.music],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt className="font-semibold">{k}</dt>
                      <dd className="text-ink-soft">{v}</dd>
                    </div>
                  ))}
              </dl>
            </details>
          )}

          {d.transcript && (
            <details className="rounded-xl border border-line p-3">
              <summary className="cursor-pointer font-medium">Transcripción</summary>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{d.transcript}</p>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
