import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Niche, SortKey, Status, Video } from '../types';
import { VideoCard } from './VideoCard';
import { Button, EmptyState, Select, Spinner, TextInput } from './ui';

const SORTS: Array<[SortKey, string]> = [
  ['score', 'Puntaje viral'],
  ['vph', 'Vistas por hora'],
  ['growth', 'Crecimiento medido'],
  ['ratio', 'Frente a su canal'],
  ['views', 'Vistas totales'],
  ['recent', 'Más recientes'],
];

export function VideosView({
  niches,
  status,
  preset,
  version,
  onCreateProject,
  onScan,
  onSeedDemo,
}: {
  niches: Niche[];
  status: Status;
  preset: { nicheId?: number; q?: string };
  version: number;
  onCreateProject: (video: Video) => void;
  onScan: () => void;
  onSeedDemo: () => void;
}) {
  const [nicheId, setNicheId] = useState(preset.nicheId ? String(preset.nicheId) : '');
  const [duration, setDuration] = useState<'short' | 'any'>('short');
  const [days, setDays] = useState(14);
  const [sort, setSort] = useState<SortKey>('score');
  const [minScore, setMinScore] = useState(0);
  const [qInput, setQInput] = useState(preset.q ?? '');
  const [q, setQ] = useState(preset.q ?? '');

  const [data, setData] = useState<{ total: number; videos: Video[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 350);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .videos({ days, nicheId: nicheId ? Number(nicheId) : undefined, duration, minScore, q: q || undefined, sort, limit: 60 })
      .then((res) => !cancelled && setData(res))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [days, nicheId, duration, minScore, q, sort, version]);

  const filtersActive = Boolean(nicheId || q || minScore > 0);

  return (
    <section aria-label="Videos virales" className="space-y-6">
      <div className="grid gap-3 rounded-2xl border border-line bg-card p-4 sm:grid-cols-2 lg:grid-cols-6">
        <label className="flex flex-col gap-1.5 lg:col-span-2">
          <span className="text-sm font-medium">Buscar</span>
          <TextInput
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Título o canal"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Nicho</span>
          <Select value={nicheId} onChange={(e) => setNicheId(e.target.value)}>
            <option value="">Todos</option>
            {niches.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Formato</span>
          <Select value={duration} onChange={(e) => setDuration(e.target.value as 'short' | 'any')}>
            <option value="short">Cortos (hasta 3 min)</option>
            <option value="any">Todos</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Publicados en</span>
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={2}>Últimos 2 días</option>
            <option value={7}>Últimos 7 días</option>
            <option value={14}>Últimos 14 días</option>
            <option value={30}>Últimos 30 días</option>
            <option value={90}>Últimos 90 días</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Ordenar por</span>
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-3">
          <span className="text-sm font-medium">
            Puntaje mínimo: <span className="tabular-nums">{minScore}</span>
          </span>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="accent-accent"
          />
        </label>
        {filtersActive && (
          <div className="flex items-end lg:col-span-3">
            <Button
              variant="ghost"
              onClick={() => {
                setNicheId('');
                setQInput('');
                setQ('');
                setMinScore(0);
              }}
            >
              Quitar filtros
            </Button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-danger">
          {error}
        </p>
      )}

      {!data && !error && <Spinner label="Buscando videos" />}

      {data && data.videos.length === 0 && (
        <EmptyState
          title={status.totalVideos === 0 ? 'Todavía no hay videos' : 'Ningún video cumple esos filtros'}
          actions={
            status.totalVideos === 0 ? (
              <>
                <Button variant="primary" onClick={onScan}>
                  Escanear YouTube
                </Button>
                <Button onClick={onSeedDemo}>Cargar datos de demo</Button>
              </>
            ) : undefined
          }
        >
          {status.totalVideos === 0
            ? 'Escanea YouTube para traer videos y calcular su puntaje viral, o carga datos de demo para recorrer el panel.'
            : 'Prueba con una ventana de días más amplia, otro nicho o un puntaje mínimo menor.'}
        </EmptyState>
      )}

      {data && data.videos.length > 0 && (
        <>
          <p className="text-sm text-ink-soft" role="status">
            {data.total > data.videos.length
              ? `Mostrando ${data.videos.length} de ${data.total} videos`
              : `${data.total} ${data.total === 1 ? 'video' : 'videos'}`}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.videos.map((video) => (
              <VideoCard key={video.id} video={video} onCreateProject={onCreateProject} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
