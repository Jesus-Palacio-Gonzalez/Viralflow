import { useEffect, useState } from 'react';
import { api } from '../api';
import { cn, fmtNum, heatText } from '../lib/format';
import type { Niche, Status, Term } from '../types';
import { Button, EmptyState, HeatBar, Select, Spinner } from './ui';

function NicheRow({ niche, rank, onOpen }: { niche: Niche; rank: number; onOpen: () => void }) {
  return (
    <li className="grid grid-cols-[2.5rem_1fr] gap-x-3 rounded-2xl border border-line bg-card p-4 sm:grid-cols-[3rem_1fr_auto] sm:gap-x-5">
      <span className="font-display text-4xl leading-none tabular-nums text-ink-soft/60" aria-label={`Puesto ${rank}`}>
        {rank}
      </span>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="font-display text-3xl leading-none">{niche.name}</h3>
          {niche.lowSample && (
            <span className="rounded-md bg-caution px-2 py-0.5 text-xs font-medium text-warn">
              Pocos datos: escanéalo de nuevo para confirmar
            </span>
          )}
        </div>
        <HeatBar value={niche.nicheScore} label={`Calor del nicho ${niche.name}: ${Math.round(niche.nicheScore)} de 100`} height={10} animate />
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-1.5">
            <dt className="text-ink-soft">Videos</dt>
            <dd className="font-semibold tabular-nums">{niche.videos}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-ink-soft">Canales</dt>
            <dd className="font-semibold tabular-nums">{niche.channels}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-ink-soft">Vistas por hora (prom.)</dt>
            <dd className="font-semibold tabular-nums">{fmtNum(niche.avgVph)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-ink-soft">Canales pequeños que explotaron</dt>
            <dd className="font-semibold tabular-nums">{Math.round(niche.opportunity)}%</dd>
          </div>
        </dl>
      </div>

      <div className="col-span-2 mt-3 flex items-center justify-between gap-4 sm:col-span-1 sm:mt-0 sm:flex-col sm:items-end sm:justify-between">
        <p className="flex items-baseline gap-1" aria-label={`Puntaje del nicho ${Math.round(niche.nicheScore)}`}>
          <span className="font-display text-5xl leading-none tabular-nums" style={{ color: heatText(niche.nicheScore) }}>
            {Math.round(niche.nicheScore)}
          </span>
        </p>
        <Button onClick={onOpen}>Ver videos</Button>
      </div>
    </li>
  );
}

export function NichesView({
  status,
  version,
  onOpenNiche,
  onOpenTerm,
  onScan,
  onSeedDemo,
}: {
  status: Status;
  version: number;
  onOpenNiche: (nicheId: number) => void;
  onOpenTerm: (term: string) => void;
  onScan: (nicheIds?: number[]) => void;
  onSeedDemo: () => void;
}) {
  const [days, setDays] = useState(30);
  const [niches, setNiches] = useState<Niche[] | null>(null);
  const [terms, setTerms] = useState<Term[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([api.niches(days), api.terms(Math.min(days, 14))])
      .then(([n, t]) => {
        if (cancelled) return;
        setNiches(n);
        setTerms(t);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [days, version]);

  if (error) {
    return (
      <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-danger">
        {error}
      </p>
    );
  }
  if (!niches) return <Spinner label="Calculando nichos" />;

  const ranked = niches.filter((n) => n.videos > 0);
  const empty = niches.filter((n) => n.videos === 0);

  if (ranked.length === 0) {
    return (
      <EmptyState
        title="Aún no sabemos qué nichos están calientes"
        actions={
          <>
            <Button variant="primary" onClick={() => onScan(niches.slice(0, 6).map((n) => n.id))}>
              Escanear nichos
            </Button>
            {status.demoVideos === 0 && <Button onClick={onSeedDemo}>Cargar datos de demo</Button>}
          </>
        }
      >
        Escanea algunos nichos para ver cuáles tienen videos explotando y cuáles son accesibles para canales pequeños.
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <section aria-label="Ranking de nichos" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="max-w-xl text-ink-soft">
            El calor mezcla los picos del nicho, su promedio y cuántos canales pequeños lograron explotar. Un nicho caliente con
            mucha oportunidad es el más fácil de replicar.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium">Ventana</span>
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-auto">
              <option value={7}>7 días</option>
              <option value={14}>14 días</option>
              <option value={30}>30 días</option>
              <option value={90}>90 días</option>
            </Select>
          </label>
        </div>

        <ol className="space-y-3">
          {ranked.map((niche, i) => (
            <NicheRow key={niche.id} niche={niche} rank={i + 1} onOpen={() => onOpenNiche(niche.id)} />
          ))}
        </ol>

        {empty.length > 0 && (
          <div className="rounded-2xl border border-dashed border-line p-4">
            <h3 className="font-semibold">Sin datos todavía</h3>
            <p className="mb-3 mt-1 text-sm text-ink-soft">
              Estos nichos aún no se han escaneado. Elige uno para incluirlo en el ranking.
            </p>
            <ul className="flex flex-wrap gap-2">
              {empty.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onScan([n.id])}
                    className={cn(
                      'rounded-full border border-line bg-card px-3 py-1.5 text-sm text-ink-soft',
                      'hover:border-accent hover:text-accent',
                    )}
                  >
                    {n.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <aside aria-label="Términos en alza" className="h-fit rounded-2xl border border-line bg-card p-4 lg:sticky lg:top-6">
        <h3 className="font-display text-3xl">Términos en alza</h3>
        <p className="mb-4 mt-1 text-sm text-ink-soft">
          Palabras y etiquetas que se repiten en varios canales distintos, en videos con buen puntaje.
        </p>
        {terms.length === 0 ? (
          <p className="text-sm text-ink-soft">Hace falta escanear más videos para detectar términos repetidos.</p>
        ) : (
          <ul className="space-y-1">
            {terms.slice(0, 14).map((t) => (
              <li key={t.term}>
                <button
                  type="button"
                  onClick={() => onOpenTerm(t.term)}
                  className="group w-full rounded-lg px-2 py-2 text-left hover:bg-paper"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-medium group-hover:text-accent">{t.term}</span>
                    <span className="text-xs tabular-nums text-ink-soft">
                      {t.videos} videos · {t.channels} canales
                    </span>
                  </span>
                  <span className="mt-1.5 block">
                    <HeatBar value={t.avgScore} label={`Puntaje medio de "${t.term}": ${Math.round(t.avgScore)}`} height={4} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
