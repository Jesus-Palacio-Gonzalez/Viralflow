import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { cn, fmtInt } from '../lib/format';
import type { Catalog, Niche, ScanMode, ScanParams, ScanSummary, Status } from '../types';
import { Button, Field, Modal, Select, TextInput, ToggleChip } from './ui';

const REGIONS: Array<[string, string]> = [
  ['CO', 'Colombia'],
  ['MX', 'México'],
  ['AR', 'Argentina'],
  ['CL', 'Chile'],
  ['PE', 'Perú'],
  ['EC', 'Ecuador'],
  ['ES', 'España'],
  ['US', 'Estados Unidos'],
  ['BR', 'Brasil'],
];

const MODES: Array<{ id: ScanMode; label: string; help: string }> = [
  { id: 'niches', label: 'Nichos', help: 'Busca los videos más vistos de cada nicho que elijas. Es lo que alimenta el ranking.' },
  { id: 'trending', label: 'Tendencias', help: 'Lee lo que YouTube destaca hoy en cada categoría. Gasta muy poca cuota.' },
  { id: 'keyword', label: 'Palabra clave', help: 'Una búsqueda libre, para explorar un tema que no está en tus nichos.' },
];

export function ScanDialog({
  open,
  onClose,
  niches,
  catalog,
  status,
  presetNicheIds,
  onFinished,
}: {
  open: boolean;
  onClose: () => void;
  niches: Niche[];
  catalog: Catalog | null;
  status: Status | null;
  presetNicheIds?: number[];
  onFinished: (summary: ScanSummary) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Escanear YouTube" wide>
      {catalog && status && (
        <Form
          niches={niches}
          catalog={catalog}
          status={status}
          presetNicheIds={presetNicheIds}
          onClose={onClose}
          onFinished={onFinished}
        />
      )}
    </Modal>
  );
}

function Form({
  niches,
  catalog,
  status,
  presetNicheIds,
  onClose,
  onFinished,
}: {
  niches: Niche[];
  catalog: Catalog;
  status: Status;
  presetNicheIds?: number[];
  onClose: () => void;
  onFinished: (summary: ScanSummary) => void;
}) {
  const [mode, setMode] = useState<ScanMode>('niches');
  const [selected, setSelected] = useState<Set<number>>(new Set(presetNicheIds ?? []));
  const [cats, setCats] = useState<Set<string>>(new Set(catalog.defaultTrendingCategories));
  const [query, setQuery] = useState('');
  const [regionCode, setRegionCode] = useState('CO');
  const [language, setLanguage] = useState('es');
  const [days, setDays] = useState(14);
  const [duration, setDuration] = useState<'short' | 'any'>('short');
  const [order, setOrder] = useState<'viewCount' | 'date'>('viewCount');
  const [pages, setPages] = useState(1);

  const [estimate, setEstimate] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanSummary | null>(null);

  const params = useMemo<ScanParams>(
    () => ({
      mode,
      nicheIds: mode === 'niches' ? [...selected] : undefined,
      query: mode === 'keyword' ? query.trim() : undefined,
      regionCode,
      language,
      publishedWithinDays: days,
      duration,
      order,
      pages,
      categoryIds: mode === 'trending' ? [...cats] : undefined,
    }),
    [mode, selected, cats, query, regionCode, language, days, duration, order, pages],
  );

  const ready =
    (mode === 'niches' && selected.size > 0) ||
    (mode === 'trending' && cats.size > 0) ||
    (mode === 'keyword' && query.trim().length >= 2);

  useEffect(() => {
    if (!ready) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .estimate(params)
        .then((r) => !cancelled && setEstimate(r.units))
        .catch(() => !cancelled && setEstimate(null));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [params, ready]);

  const overBudget = estimate != null && estimate > status.quota.remaining;

  const run = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    try {
      const summary = await api.scan(params);
      setResult(summary);
      onFinished(summary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const toggleNiche = (id: number, on: boolean): void => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };
  const toggleCat = (id: string, on: boolean): void => {
    const next = new Set(cats);
    if (on) next.add(id);
    else next.delete(id);
    setCats(next);
  };

  if (result) {
    return (
      <div className="space-y-4">
        <p className="text-lg">
          Se encontraron <strong className="tabular-nums">{result.found}</strong> videos ({result.inserted} nuevos,{' '}
          {result.updated} actualizados). Usó <strong className="tabular-nums">{fmtInt(result.unitsUsed)}</strong> unidades de cuota.
        </p>
        {result.warning && (
          <p role="alert" className="rounded-xl bg-caution px-4 py-3 text-sm text-warn">
            {result.warning}
          </p>
        )}
        {result.found > 0 && result.updated > 0 && (
          <p className="text-sm text-ink-soft">
            Los videos que ya estaban se actualizaron y ahora tienen un punto más de historial para medir su crecimiento real.
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Ver resultados
          </Button>
        </div>
      </div>
    );
  }

  const help = MODES.find((m) => m.id === mode)!.help;

  return (
    <div className="space-y-5">
      {!status.apiKeyConfigured && (
        <p role="alert" className="rounded-xl bg-caution px-4 py-3 text-sm text-warn">
          Falta la API key de YouTube. Agrégala como <code>YOUTUBE_API_KEY</code> en el archivo <code>.env</code> y reinicia el
          servidor. Mientras tanto puedes probar el panel con datos de demo.
        </p>
      )}

      <div role="tablist" aria-label="Tipo de escaneo" className="flex gap-1 rounded-xl bg-paper p-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => setMode(m.id)}
            className={cn(
              'flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
              mode === m.id ? 'bg-raised text-ink shadow-sm' : 'text-ink-soft hover:text-ink',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-ink-soft">{help}</p>

      {mode === 'niches' && (
        <fieldset>
          <legend className="mb-2 flex w-full items-center justify-between text-sm font-medium">
            <span>Nichos ({selected.size} elegidos)</span>
            <span className="flex gap-1">
              <button type="button" className="px-2 text-ink-soft hover:text-ink" onClick={() => setSelected(new Set(niches.map((n) => n.id)))}>
                Todos
              </button>
              <button type="button" className="px-2 text-ink-soft hover:text-ink" onClick={() => setSelected(new Set())}>
                Ninguno
              </button>
            </span>
          </legend>
          <ul className="flex flex-wrap gap-2">
            {[...niches]
              .sort((a, b) => a.name.localeCompare(b.name, 'es'))
              .map((n) => (
              <li key={n.id}>
                <ToggleChip checked={selected.has(n.id)} onChange={(on) => toggleNiche(n.id, on)}>
                  {n.name}
                </ToggleChip>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {mode === 'trending' && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Categorías ({cats.size} elegidas)</legend>
          <ul className="flex flex-wrap gap-2">
            {catalog.categories.map((c) => (
              <li key={c.id}>
                <ToggleChip checked={cats.has(c.id)} onChange={(on) => toggleCat(c.id, on)}>
                  {c.name}
                </ToggleChip>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {mode === 'keyword' && (
        <Field label="Palabra clave">
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Por ejemplo: recetas saludables" maxLength={100} />
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="País">
          <Select value={regionCode} onChange={(e) => setRegionCode(e.target.value)}>
            {REGIONS.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        {mode !== 'trending' && (
          <Field label="Idioma">
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="es">Español</option>
              <option value="en">Inglés</option>
              <option value="pt">Portugués</option>
            </Select>
          </Field>
        )}
        <Field label="Publicados en">
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={2}>Últimos 2 días</option>
            <option value={7}>Últimos 7 días</option>
            <option value={14}>Últimos 14 días</option>
            <option value={30}>Últimos 30 días</option>
          </Select>
        </Field>
        <Field label="Formato">
          <Select value={duration} onChange={(e) => setDuration(e.target.value as 'short' | 'any')}>
            <option value="short">Cortos (hasta 3 min)</option>
            <option value="any">Todos</option>
          </Select>
        </Field>
        {mode !== 'trending' && (
          <>
            <Field label="Buscar" hint={order === 'date' ? 'Ideal para cazar videos en sus primeras horas.' : undefined}>
              <Select value={order} onChange={(e) => setOrder(e.target.value as 'viewCount' | 'date')}>
                <option value="viewCount">Los más vistos</option>
                <option value="date">Los más recientes</option>
              </Select>
            </Field>
            <Field label="Páginas por búsqueda" hint="Cada página trae hasta 50 videos.">
              <Select value={pages} onChange={(e) => setPages(Number(e.target.value))}>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </Select>
            </Field>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className={cn('text-sm', overBudget ? 'text-danger' : 'text-ink-soft')} role="status">
          {estimate == null ? (
            'Elige qué escanear para ver el costo.'
          ) : (
            <>
              Costo estimado: <strong className="tabular-nums text-ink">{fmtInt(estimate)}</strong> de{' '}
              <span className="tabular-nums">{fmtInt(status.quota.remaining)}</span> unidades que quedan hoy
              {overBudget && '. Reduce nichos o páginas.'}
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={run} disabled={!ready || running || overBudget || !status.apiKeyConfigured}>
            {running ? 'Escaneando…' : 'Escanear'}
          </Button>
        </div>
      </div>

      {running && (
        <p role="status" className="text-sm text-ink-soft">
          Consultando YouTube. Puede tardar hasta un minuto si elegiste varios nichos.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
