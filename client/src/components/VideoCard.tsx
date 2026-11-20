import { useState } from 'react';
import { cn, fmtAge, fmtDuration, fmtInt, fmtNum, heatFill, heatText } from '../lib/format';
import type { Video } from '../types';
import { Button, HeatBar } from './ui';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Tag({ children, tone = 'neutral' }: { children: string; tone?: 'neutral' | 'hot' | 'demo' }) {
  return (
    <span
      className={cn(
        'rounded-md px-2 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'bg-ink/5 text-ink-soft',
        tone === 'hot' && 'bg-hot/15 text-hot-text',
        tone === 'demo' && 'bg-caution text-warn',
      )}
    >
      {children}
    </span>
  );
}

function Thumb({ video }: { video: Video }) {
  const [broken, setBroken] = useState(false);
  const { score } = video.metrics;
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-ink/5">
      {video.thumbnail && !broken ? (
        <img
          src={video.thumbnail}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className="flex h-full w-full items-end p-3"
          style={{ background: `linear-gradient(135deg, ${heatFill(score * 0.6)}, ${heatFill(Math.min(100, score * 0.6 + 30))})` }}
        >
          <span className="font-display text-xl leading-none text-white/90">{video.channelTitle}</span>
        </div>
      )}
      <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-xs font-medium tabular-nums text-white">
        {fmtDuration(video.durationS)}
      </span>
    </div>
  );
}

const BREAKDOWN: Array<{ key: 'velocity' | 'outlier' | 'engagement' | 'reach'; label: string; weight: string }> = [
  { key: 'velocity', label: 'Velocidad', weight: '40%' },
  { key: 'outlier', label: 'Frente a su canal', weight: '30%' },
  { key: 'engagement', label: 'Interacción', weight: '15%' },
  { key: 'reach', label: 'Alcance', weight: '15%' },
];

export function VideoCard({ video, onCreateProject }: { video: Video; onCreateProject: (video: Video) => void }) {
  const [open, setOpen] = useState(false);
  const m = video.metrics;
  const young = m.ageHours <= 48;

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-4 transition-[border-color,box-shadow] hover:border-hot/50 hover:shadow-[0_0_36px_-12px_rgb(255_61_110/0.55)]">
      <Thumb video={video} />

      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-5xl leading-none tabular-nums" style={{ color: heatText(m.score) }}>
            {Math.round(m.score)}
          </span>
          <span className="text-sm text-ink-soft">/ 100</span>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {video.source === 'demo' && <Tag tone="demo">Demo</Tag>}
          {young && <Tag tone="hot">Primeras horas</Tag>}
          {video.growthVph != null && video.growthVph > 0 && <Tag>{`+${fmtNum(video.growthVph)} vistas/h`}</Tag>}
        </div>
      </div>
      <HeatBar value={m.score} label={`Puntaje viral ${Math.round(m.score)} de 100`} height={8} />

      <div>
        <h3 className="clamp-2 font-semibold leading-snug">{video.title}</h3>
        <p className="mt-1 text-sm text-ink-soft">
          {video.channelTitle}
          {video.subscribers != null && ` · ${fmtNum(video.subscribers)} suscriptores`}
        </p>
      </div>

      <dl className="grid grid-cols-4 gap-2 text-sm">
        <Stat label="Vistas" value={fmtNum(video.views)} />
        <Stat label="Por hora" value={fmtNum(m.vph)} />
        <Stat label="Vs. canal" value={m.ratio == null ? '—' : `${m.ratio >= 10 ? Math.round(m.ratio) : m.ratio}×`} />
        <Stat label="Publicado" value={fmtAge(m.ageHours)} />
      </dl>

      {open && (
        <div className="space-y-2.5 rounded-xl bg-paper p-3">
          {BREAKDOWN.map(({ key, label, weight }) => {
            const value = m[key];
            return (
              <div key={key}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>
                    {label} <span className="text-ink-soft">({weight})</span>
                  </span>
                  <span className="tabular-nums text-ink-soft">{value == null ? 'sin dato' : Math.round(value)}</span>
                </div>
                <HeatBar value={value ?? 0} label={`${label}: ${value == null ? 'sin dato' : Math.round(value)}`} height={4} />
              </div>
            );
          })}
          <p className="pt-1 text-xs text-ink-soft">
            {fmtInt(video.likes)} me gusta · {fmtInt(video.comments)} comentarios
            {m.engagementRate != null && ` · ${(m.engagementRate * 100).toFixed(1)}% de interacción`}
          </p>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => onCreateProject(video)}>
          Crear proyecto
        </Button>
        <a
          href={video.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-ink/5 hover:text-ink"
        >
          Ver en YouTube
        </a>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto rounded-lg px-2 py-2 text-sm text-ink-soft hover:text-ink"
        >
          {open ? 'Ocultar desglose' : 'Cómo se calculó'}
        </button>
      </div>
    </article>
  );
}
