import { useState } from 'react';
import { api } from '../api';
import { copyText } from '../lib/copy';
import { cn } from '../lib/format';
import type { FormatPreset, Project, Scene, ScriptDTO, ScriptParams } from '../types';
import { Button, Field, Modal, Select, Textarea, TextInput } from './ui';

const DURATIONS = [15, 20, 30, 45, 60];
const FLOW_URL = 'https://labs.google/fx/tools/flow';

const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

function SceneCard({
  projectId,
  scene,
  onSaved,
  onNotify,
}: {
  projectId: number;
  scene: Scene;
  onSaved: (script: ScriptDTO) => void;
  onNotify: (message: string, kind: 'ok' | 'error') => void;
}) {
  const [voiceover, setVoiceover] = useState(scene.voiceover);
  const [onScreenText, setOnScreenText] = useState(scene.onScreenText);
  const [visualPrompt, setVisualPrompt] = useState(scene.visualPrompt);
  const [durationS, setDurationS] = useState(scene.durationS);
  const [saving, setSaving] = useState(false);

  const dirty =
    voiceover !== scene.voiceover ||
    onScreenText !== scene.onScreenText ||
    visualPrompt !== scene.visualPrompt ||
    durationS !== scene.durationS;
  const words = wordCount(voiceover);
  const tooLong = words > durationS * 3;
  const validPrompt = visualPrompt.trim().length >= 5;

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      onSaved(await api.updateScript(projectId, { scenes: [{ n: scene.n, voiceover, onScreenText, visualPrompt, durationS }] }));
      onNotify(`Escena ${scene.n} guardada.`, 'ok');
    } catch (e) {
      onNotify((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="space-y-3 rounded-2xl border border-line bg-card p-4">
      <header className="flex items-center justify-between gap-3">
        <h4 className="font-display text-3xl leading-none">Escena {scene.n}</h4>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-soft">Duración</span>
          <input
            type="number"
            min={2}
            max={8}
            step={1}
            value={durationS}
            onChange={(e) => setDurationS(Math.min(8, Math.max(2, Math.round(Number(e.target.value) || 2))))}
            className="w-16 rounded-lg border border-line bg-sunken px-2 py-1.5 text-center tabular-nums hover:border-ink-soft"
          />
          <span className="text-ink-soft">s</span>
        </label>
      </header>

      <Field label="Voz en off">
        <Textarea rows={2} value={voiceover} onChange={(e) => setVoiceover(e.target.value)} />
      </Field>
      {tooLong && (
        <p role="status" className="-mt-1 text-sm text-warn">
          Son {words} palabras para {durationS} s: se oirá apurado. Acorta el texto o alarga la escena.
        </p>
      )}

      <Field label="Texto en pantalla">
        <TextInput value={onScreenText} onChange={(e) => setOnScreenText(e.target.value)} maxLength={300} />
      </Field>

      <Field label="Prompt de la escena para Flow">
        <Textarea rows={4} value={visualPrompt} onChange={(e) => setVisualPrompt(e.target.value)} />
      </Field>

      <details className="rounded-xl bg-paper p-3">
        <summary className="cursor-pointer text-sm font-medium">Ver el prompt completo que se copia</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-soft">{scene.flowPrompt}</pre>
        <p className="mt-2 text-xs text-ink-soft">Incluye el estilo visual común, el sonido ambiente y el formato.</p>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => copyText(scene.flowPrompt, onNotify, `Prompt de la escena ${scene.n} copiado.`)} disabled={dirty}>
          Copiar prompt
        </Button>
        <Button onClick={save} disabled={!dirty || saving || !validPrompt}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </Button>
        {dirty && <p className="text-sm text-ink-soft">Guarda para actualizar el prompt que se copia.</p>}
      </div>
    </article>
  );
}

function StyleEditor({
  projectId,
  value,
  onSaved,
  onNotify,
}: {
  projectId: number;
  value: string;
  onSaved: (script: ScriptDTO) => void;
  onNotify: (message: string, kind: 'ok' | 'error') => void;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const dirty = draft.trim() !== value.trim();

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      onSaved(await api.updateScript(projectId, { styleBible: draft }));
      onNotify('Estilo guardado en todas las escenas.', 'ok');
    } catch (e) {
      onNotify((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-2xl border border-line bg-card p-4">
      <Field label="Estilo visual común" hint="Se añade a cada prompt para que todos los clips se parezcan entre sí.">
        <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
      </Field>
      <Button onClick={save} disabled={!dirty || saving}>
        {saving ? 'Guardando…' : 'Guardar estilo'}
      </Button>
    </div>
  );
}

export function ScriptPanel({
  project,
  formats,
  script,
  aiConfigured,
  hasAnalysis,
  onScript,
  onNotify,
}: {
  project: Project;
  formats: FormatPreset[];
  script: ScriptDTO | null;
  aiConfigured: boolean;
  hasAnalysis: boolean;
  onScript: (script: ScriptDTO) => void;
  onNotify: (message: string, kind: 'ok' | 'error') => void;
}) {
  const projectFormats = project.platforms.map((id) => formats.find((f) => f.id === id)).filter((f): f is FormatPreset => Boolean(f));
  const [topic, setTopic] = useState(script?.params.topic ?? '');
  const [language, setLanguage] = useState<ScriptParams['language']>(script?.params.language ?? 'es');
  const [targetSeconds, setTargetSeconds] = useState(script?.params.targetSeconds ?? 30);
  const [formatId, setFormatId] = useState(script?.params.formatId ?? projectFormats[0]?.id ?? '');
  const [promptLanguage, setPromptLanguage] = useState<ScriptParams['promptLanguage']>(script?.params.promptLanguage ?? 'en');
  const [tone, setTone] = useState(script?.params.tone ?? '');

  const [showForm, setShowForm] = useState(script == null);
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedFormat = projectFormats.find((f) => f.id === formatId);
  const cropped = selectedFormat != null && selectedFormat.aspect !== '9:16' && selectedFormat.aspect !== '16:9';

  const generate = async (): Promise<void> => {
    setConfirm(false);
    setRunning(true);
    setError(null);
    try {
      const result = await api.generateScript(project.id, {
        topic: topic.trim() || undefined,
        language,
        targetSeconds,
        formatId: formatId || undefined,
        promptLanguage,
        tone: tone.trim() || undefined,
      });
      onScript(result);
      setShowForm(false);
      onNotify('Guion y prompts listos. Se guardaron en las carpetas del proyecto.', 'ok');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (script) setConfirm(true);
    else void generate();
  };

  const allPrompts = script?.data.scenes.map((s) => `Escena ${s.n} · ${s.durationS} s\n${s.flowPrompt}`).join('\n\n---\n\n') ?? '';
  const delta = script ? script.totalS - script.params.targetSeconds : 0;

  return (
    <section aria-labelledby="script-title" className="space-y-5 rounded-2xl border border-line bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="script-title" className="font-display text-4xl leading-tight">
            Guion y prompts para Flow
          </h2>
          <p className="mt-1 max-w-2xl text-ink-soft">
            {hasAnalysis
              ? 'La IA escribe un guion original con la fórmula del análisis y lo divide en escenas, cada una con su prompt.'
              : 'Aún no hay análisis: la IA usará una estructura genérica de video corto. Analiza primero el video para un resultado más fiel.'}
          </p>
        </div>
        {script && !showForm && (
          <Button variant="ghost" onClick={() => setShowForm(true)}>
            Cambiar opciones
          </Button>
        )}
      </div>

      {showForm && (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Tema o idea de tu video" hint="El contenido debe ser tuyo: la IA copia la estructura del viral, no su tema. Si lo dejas vacío, propone uno del mismo nicho.">
            <Textarea rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={600} placeholder="Por ejemplo: tres hábitos para retomar el gimnasio después de las vacaciones" />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Idioma del video">
              <Select value={language} onChange={(e) => setLanguage(e.target.value as ScriptParams['language'])}>
                <option value="es">Español</option>
                <option value="en">Inglés</option>
                <option value="pt">Portugués</option>
              </Select>
            </Field>
            <Field label="Duración objetivo">
              <Select value={targetSeconds} onChange={(e) => setTargetSeconds(Number(e.target.value))}>
                {DURATIONS.map((s) => (
                  <option key={s} value={s}>
                    {s} segundos
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Formato de salida" hint={cropped ? 'Flow genera en 9:16: se recortará al montar.' : undefined}>
              <Select value={formatId} onChange={(e) => setFormatId(e.target.value)}>
                {projectFormats.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} · {f.aspect}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Idioma de los prompts" hint="Flow suele entender mejor el inglés.">
              <Select value={promptLanguage} onChange={(e) => setPromptLanguage(e.target.value as ScriptParams['promptLanguage'])}>
                <option value="en">Inglés (recomendado)</option>
                <option value="es">Español</option>
              </Select>
            </Field>
          </div>

          <Field label="Tono (opcional)">
            <TextInput value={tone} onChange={(e) => setTone(e.target.value)} maxLength={80} placeholder="Por ejemplo: inspirador y directo" />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" disabled={running || !aiConfigured}>
              {running ? 'Generando…' : script ? 'Regenerar guion y prompts' : 'Generar guion y prompts'}
            </Button>
            {script && !running && (
              <Button variant="ghost" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
            )}
            {running && (
              <p role="status" className="text-sm text-ink-soft">
                Escribiendo el guion y los prompts. Tarda unos 20 segundos.
              </p>
            )}
          </div>
          {!aiConfigured && <p className="text-sm text-warn">Falta la GEMINI_API_KEY: sin ella no se puede generar.</p>}
        </form>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {script && !showForm && (
        <div className="space-y-6">
          <div>
            <h3 className="font-display text-4xl leading-tight">{script.data.title}</h3>
            <p className="mt-1 max-w-3xl text-ink-soft">{script.data.concept}</p>
            <ul className="mt-3 flex flex-wrap gap-1.5 text-xs font-medium">
              <li className="rounded-md bg-accent-soft px-2 py-1 text-accent">
                {script.totalS} s en {script.data.scenes.length} escenas
              </li>
              {Math.abs(delta) >= 5 && (
                <li className="rounded-md bg-caution px-2 py-1 text-warn">
                  {delta > 0 ? `${delta} s más` : `${-delta} s menos`} que el objetivo de {script.params.targetSeconds} s
                </li>
              )}
              <li className="rounded-md bg-ink/5 px-2 py-1 text-ink-soft">
                {script.params.platformLabel ?? 'Redes'} · {script.params.aspect}
              </li>
              <li className="rounded-md bg-ink/5 px-2 py-1 text-ink-soft">{script.model}</li>
            </ul>
          </div>

          <StyleEditor key={`style-${script.updatedAt}`} projectId={project.id} value={script.data.styleBible} onSaved={onScript} onNotify={onNotify} />

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => copyText(allPrompts, onNotify, 'Todos los prompts copiados.')}>
              Copiar todos los prompts
            </Button>
            <a
              href={FLOW_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-line bg-card px-3.5 py-2 text-sm font-semibold hover:border-ink-soft"
            >
              Abrir Google Flow
            </a>
            <p className="text-sm text-ink-soft">Genera un clip por escena y guárdalo en la carpeta 04-clips.</p>
          </div>

          {script.data.alternativeHooks.length > 0 && (
            <details className="rounded-xl border border-hot/40 p-3">
              <summary className="cursor-pointer font-medium">Ganchos alternativos para la escena 1</summary>
              <ul className="mt-3 space-y-3">
                {script.data.alternativeHooks.map((h, i) => (
                  <li key={i} className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-ink/[0.03] p-3">
                    <div className="min-w-0 flex-1">
                      <p className="leading-snug">{h.voiceover || h.onScreenText}</p>
                      {h.technique && <p className="mt-0.5 text-xs text-ink-soft">{h.technique}</p>}
                    </div>
                    <Button
                      onClick={async () => {
                        try {
                          onScript(
                            await api.updateScript(project.id, {
                              scenes: [
                                {
                                  n: 1,
                                  voiceover: h.voiceover,
                                  onScreenText: h.onScreenText,
                                  ...(h.visualPrompt.trim().length >= 5 ? { visualPrompt: h.visualPrompt } : {}),
                                },
                              ],
                            }),
                          );
                          onNotify('Gancho aplicado a la escena 1.', 'ok');
                        } catch (e) {
                          onNotify((e as Error).message, 'error');
                        }
                      }}
                    >
                      Usar este gancho
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="space-y-3">
            {script.data.scenes.map((scene) => (
              <SceneCard key={`${scene.n}-${script.updatedAt}`} projectId={project.id} scene={scene} onSaved={onScript} onNotify={onNotify} />
            ))}
          </div>

          <div className={cn('space-y-3 rounded-2xl border border-line p-4')}>
            <h3 className="font-semibold">Para publicar</h3>
            <p className="leading-relaxed">{script.data.caption}</p>
            <p className="text-accent">{script.data.hashtags.map((h) => `#${h}`).join(' ')}</p>
            <p className="text-sm text-ink-soft">Música sugerida: {script.data.musicSuggestion || '—'}</p>
            <Button
              onClick={() => copyText(`${script.data.caption}\n\n${script.data.hashtags.map((h) => `#${h}`).join(' ')}`, onNotify, 'Descripción copiada.')}
            >
              Copiar descripción y hashtags
            </Button>
          </div>
        </div>
      )}

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Regenerar el guion">
        <p className="text-ink-soft">
          Se reemplazarán el guion y los prompts actuales, <strong className="text-ink">incluidos los cambios que hayas hecho a mano</strong>. Los archivos de
          las carpetas del proyecto también se sobrescriben.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={generate}>
            Regenerar
          </Button>
        </div>
      </Modal>
    </section>
  );
}
