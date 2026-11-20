import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/format';

export const HEAT_GRADIENT = 'linear-gradient(90deg, #3a63ff 0%, #ff3d6e 62%, #ffb020 100%)';

/** Barra térmica: el degradado es fijo, así que un valor alto "revela" más calor. */
export function HeatBar({
  value,
  label,
  height = 6,
  animate = false,
}: {
  value: number;
  label: string;
  height?: number;
  animate?: boolean;
}) {
  const v = Math.min(100, Math.max(0, value));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      className="w-full overflow-hidden rounded-full bg-line/70"
      style={{ height }}
    >
      <div
        className={cn('h-full rounded-full', animate && 'heat-grow')}
        style={{ width: `${v}%`, backgroundImage: HEAT_GRADIENT, backgroundSize: `${10000 / Math.max(v, 4)}% 100%` }}
      />
    </div>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-inverse text-on-inverse hover:bg-white',
  secondary: 'border border-line bg-raised text-ink hover:border-ink-soft',
  ghost: 'text-ink-soft hover:bg-ink/5 hover:text-ink',
  danger: 'bg-danger text-on-inverse hover:bg-danger/85',
};

export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export function ToggleChip({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="inline-block w-fit max-w-full cursor-pointer">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="block rounded-full border border-line bg-sunken px-3 py-1.5 text-sm text-ink-soft transition-colors hover:border-ink-soft peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
        {children}
      </span>
    </label>
  );
}

/** La etiqueta envuelve al control, así queda asociada sin necesidad de ids. */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

const CONTROL =
  'w-full rounded-lg border border-line bg-sunken px-3 py-2 text-sm text-ink placeholder:text-ink-soft/70 hover:border-ink-soft';

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(CONTROL, props.className)} />;
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(CONTROL, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(CONTROL, 'resize-y leading-relaxed', props.className)} />;
}

/** Modal basado en <dialog>: foco atrapado, Esc y fondo bloqueado de forma nativa. */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={cn('modal', wide && 'modal-wide')}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <h2 id={titleId} className="font-display text-3xl leading-tight">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="-mr-2 -mt-1 rounded-lg px-2.5 py-1 text-2xl leading-none text-ink-soft hover:bg-ink/5 hover:text-ink"
            >
              ×
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function EmptyState({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-card/60 px-6 py-12 text-center">
      <h3 className="font-display text-3xl">{title}</h3>
      {children && <p className="mx-auto mt-2 max-w-md text-ink-soft">{children}</p>}
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-3">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = 'Cargando' }: { label?: string }) {
  return (
    <p role="status" className="py-10 text-center text-ink-soft">
      {label}…
    </p>
  );
}
