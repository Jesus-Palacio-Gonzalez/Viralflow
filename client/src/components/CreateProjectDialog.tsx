import { useState } from 'react';
import { api } from '../api';
import { cn, fmtDuration } from '../lib/format';
import type { FormatPreset, Project, Video } from '../types';
import { Button, Field, Modal, TextInput } from './ui';

export function CreateProjectDialog({
  video,
  formats,
  onClose,
  onCreated,
}: {
  video: Video | null;
  formats: FormatPreset[];
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  return (
    <Modal open={video != null} onClose={onClose} title="Crear proyecto" wide>
      {video && <Form video={video} formats={formats} onClose={onClose} onCreated={onCreated} />}
    </Modal>
  );
}

function Form({
  video,
  formats,
  onClose,
  onCreated,
}: {
  video: Video;
  formats: FormatPreset[];
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const [name, setName] = useState(video.title.slice(0, 60));
  const [platforms, setPlatforms] = useState<Set<string>>(new Set(['tiktok', 'youtube-shorts', 'instagram-reels']));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string, on: boolean): void => {
    const next = new Set(platforms);
    if (on) next.add(id);
    else next.delete(id);
    setPlatforms(next);
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const project = await api.createProject({
        name: name.trim(),
        videoId: video.id,
        nicheId: video.niches[0],
        platforms: [...platforms],
      });
      onCreated(project);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const valid = name.trim().length >= 2 && platforms.size > 0;

  return (
    <form onSubmit={submit} className="space-y-5">
      <p className="text-sm text-ink-soft">
        Referencia: <span className="font-medium text-ink">{video.title}</span> · {video.channelTitle}
      </p>

      <Field label="Nombre del proyecto">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
      </Field>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Formatos de salida</legend>
        <p className="mb-3 text-sm text-ink-soft">
          Cada formato recibe su propia carpeta de exportación con la resolución y la duración recomendadas.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {formats.map((f) => (
            <li key={f.id}>
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                  platforms.has(f.id) ? 'border-accent bg-accent-soft/50' : 'border-line hover:border-ink-soft',
                )}
              >
                <input
                  type="checkbox"
                  checked={platforms.has(f.id)}
                  onChange={(e) => toggle(f.id, e.target.checked)}
                  className="mt-1 accent-accent"
                />
                <span>
                  <span className="block font-semibold">{f.label}</span>
                  <span className="block text-sm tabular-nums text-ink-soft">
                    {f.aspect} · {f.width}×{f.height} · {f.fps} fps
                  </span>
                  <span className="block text-sm text-ink-soft">
                    Recomendado: {fmtDuration(f.recommendedSeconds.min)} a {fmtDuration(f.recommendedSeconds.max)} min
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      {error && (
        <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={!valid || saving}>
          {saving ? 'Creando…' : 'Crear proyecto'}
        </Button>
      </div>
    </form>
  );
}
