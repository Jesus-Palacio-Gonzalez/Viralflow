import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { CreateProjectDialog } from './components/CreateProjectDialog';
import { NichesView } from './components/NichesView';
import { ProjectsView } from './components/ProjectsView';
import { ScanDialog } from './components/ScanDialog';
import { Button, HEAT_GRADIENT } from './components/ui';
import { VideosView } from './components/VideosView';
import { cn, fmtInt } from './lib/format';
import type { Catalog, FormatPreset, Niche, Status, Video } from './types';

type Tab = 'niches' | 'videos' | 'projects';

const TABS: Array<[Tab, string]> = [
  ['niches', 'Nichos'],
  ['videos', 'Videos'],
  ['projects', 'Proyectos'],
];

interface Toast {
  id: number;
  message: string;
  kind: 'ok' | 'error';
}

export default function App() {
  const [tab, setTab] = useState<Tab>('niches');
  const [status, setStatus] = useState<Status | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [formats, setFormats] = useState<FormatPreset[]>([]);
  const [niches, setNiches] = useState<Niche[]>([]);
  const [bootError, setBootError] = useState<string | null>(null);

  /** Se incrementa cada vez que cambian los datos, para que las vistas se recarguen. */
  const [version, setVersion] = useState(0);
  const [videoPreset, setVideoPreset] = useState<{ nicheId?: number; q?: string }>({});
  const [videosKey, setVideosKey] = useState(0);

  const [scanOpen, setScanOpen] = useState(false);
  const [scanPreset, setScanPreset] = useState<number[] | undefined>();
  const [projectVideo, setProjectVideo] = useState<Video | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const notify = useCallback((message: string, kind: 'ok' | 'error' = 'ok') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [s, n] = await Promise.all([api.status(), api.niches(30)]);
      setStatus(s);
      setNiches(n);
      setBootError(null);
    } catch (e) {
      setBootError((e as Error).message);
    }
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    Promise.all([api.catalog(), api.formats()])
      .then(([c, f]) => {
        setCatalog(c);
        setFormats(f);
      })
      .catch((e: Error) => setBootError(e.message));
    void refresh();
  }, [refresh]);

  const openScan = (nicheIds?: number[]): void => {
    setScanPreset(nicheIds);
    setScanOpen(true);
  };

  const goToVideos = (preset: { nicheId?: number; q?: string } = {}): void => {
    setVideoPreset(preset);
    setVideosKey((k) => k + 1);
    setTab('videos');
  };

  const seedDemo = async (): Promise<void> => {
    try {
      const { videos } = await api.seedDemo();
      notify(`Se cargaron ${videos} videos de demostración.`);
      await refresh();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  const clearDemo = async (): Promise<void> => {
    try {
      await api.clearDemo();
      notify('Datos de demo eliminados.');
      await refresh();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  const quota = status?.quota;
  const quotaPct = quota ? Math.min(100, (quota.used / quota.limit) * 100) : 0;

  return (
    <div className="mx-auto min-h-dvh max-w-7xl px-4 pb-16 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pb-6 pt-8">
        <div>
          <h1 className="flex items-end gap-3 font-display text-6xl leading-none sm:text-7xl">
            <svg viewBox="0 0 28 28" aria-hidden="true" className="mb-1 h-9 w-9 shrink-0 sm:mb-1.5 sm:h-11 sm:w-11">
              <defs>
                <linearGradient id="heat-mark" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0" stopColor="#3a63ff" />
                  <stop offset="0.62" stopColor="#ff3d6e" />
                  <stop offset="1" stopColor="#ffb020" />
                </linearGradient>
              </defs>
              <rect x="2" y="15" width="5.5" height="11" rx="2.75" fill="url(#heat-mark)" />
              <rect x="11.25" y="8" width="5.5" height="18" rx="2.75" fill="url(#heat-mark)" />
              <rect x="20.5" y="2" width="5.5" height="24" rx="2.75" fill="url(#heat-mark)" />
            </svg>
            ViralFlow
          </h1>
          <p className="mt-2 max-w-md text-ink-soft">
            Encuentra qué está explotando en YouTube y prepara el proyecto para replicarlo.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {quota && (
            <div className="min-w-44" title={`Cuota diaria de la API de YouTube (día del Pacífico: ${quota.day})`}>
              <p className="flex justify-between text-xs text-ink-soft">
                <span>Cuota de hoy</span>
                <span className="tabular-nums">
                  {fmtInt(quota.used)} / {fmtInt(quota.limit)}
                </span>
              </p>
              <div
                role="meter"
                aria-label="Cuota de YouTube usada hoy"
                aria-valuemin={0}
                aria-valuemax={quota.limit}
                aria-valuenow={quota.used}
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-line"
              >
                <div className="h-full rounded-full" style={{ width: `${quotaPct}%`, backgroundImage: HEAT_GRADIENT, backgroundSize: `${10000 / Math.max(quotaPct, 4)}% 100%` }} />
              </div>
            </div>
          )}
          <Button variant="primary" onClick={() => openScan()}>
            Escanear YouTube
          </Button>
        </div>
      </header>

      {bootError && (
        <p role="alert" className="mb-6 rounded-xl bg-danger/10 px-4 py-3 text-danger">
          {bootError}
        </p>
      )}

      {status && (!status.apiKeyConfigured || status.demoVideos > 0) && (
        <div role="note" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-caution px-4 py-3 text-sm text-warn">
          <p className="max-w-3xl">
            {status.demoVideos > 0 && (
              <>
                Estás viendo <strong>{status.demoVideos} videos de demostración</strong>; no son reales y se mezclan con tus escaneos hasta
                que los elimines.{' '}
              </>
            )}
            {!status.apiKeyConfigured && (
              <>
                {status.demoVideos > 0 ? 'Además, falta' : 'Falta'} <code>YOUTUBE_API_KEY</code> en el archivo <code>.env</code>
                {status.demoVideos > 0 ? '.' : ': sin ella no se puede escanear YouTube, pero puedes recorrer el panel con datos de demo.'}
              </>
            )}
          </p>
          {status.demoVideos > 0 ? (
            <Button onClick={clearDemo}>Eliminar datos de demo</Button>
          ) : (
            <Button onClick={seedDemo}>Cargar datos de demo</Button>
          )}
        </div>
      )}

      <nav aria-label="Secciones" className="ruler mb-8">
        <ul className="-mb-px flex gap-1">
          {TABS.map(([id, label]) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => (id === 'videos' ? goToVideos(videoPreset) : setTab(id))}
                aria-current={tab === id ? 'page' : undefined}
                className={cn(
                  'relative px-4 py-3 text-base font-semibold transition-colors',
                  tab === id ? 'tab-active text-ink' : 'text-ink-soft hover:text-ink',
                )}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main>
        {tab === 'niches' && status && (
          <NichesView
            status={status}
            version={version}
            onOpenNiche={(nicheId) => goToVideos({ nicheId })}
            onOpenTerm={(q) => goToVideos({ q })}
            onScan={openScan}
            onSeedDemo={seedDemo}
          />
        )}
        {tab === 'videos' && status && (
          <VideosView
            key={videosKey}
            niches={niches}
            status={status}
            preset={videoPreset}
            version={version}
            onCreateProject={setProjectVideo}
            onScan={() => openScan()}
            onSeedDemo={seedDemo}
          />
        )}
        {tab === 'projects' && catalog && status && (
          <ProjectsView
            stages={catalog.stages}
            formats={formats}
            status={status}
            version={version}
            onChanged={() => setVersion((v) => v + 1)}
            onNotify={notify}
            onGoToVideos={() => goToVideos()}
          />
        )}
      </main>

      <ScanDialog
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        niches={niches}
        catalog={catalog}
        status={status}
        presetNicheIds={scanPreset}
        onFinished={() => void refresh()}
      />

      <CreateProjectDialog
        video={projectVideo}
        formats={formats}
        onClose={() => setProjectVideo(null)}
        onCreated={(project) => {
          setProjectVideo(null);
          notify(`Proyecto «${project.name}» creado con su estructura de carpetas.`);
          setVersion((v) => v + 1);
          setTab('projects');
        }}
      />

      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <p
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto rounded-xl px-4 py-3 text-sm font-medium shadow-lg',
              t.kind === 'error' ? 'bg-danger text-on-inverse' : 'bg-inverse text-on-inverse',
            )}
          >
            {t.message}
          </p>
        ))}
      </div>
    </div>
  );
}
