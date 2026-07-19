import clsx from 'clsx';

export const FPS_OPTIONS = [1, 5, 10, 15, 30] as const;
export type FpsOption = (typeof FPS_OPTIONS)[number];

/** A camera counts as "reduced rate" below this — drives the sidebar's low-fps badge. */
export const DEFAULT_TARGET_FPS = 20;

interface Props {
  value: number;
  onChange: (fps: FpsOption) => void;
  disabled?: boolean;
  size?: 'sm' | 'xs';
}

export function FpsSegmentedToggle({ value, onChange, disabled, size = 'sm' }: Props): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label="Inference rate (frames per second)"
      className="inline-flex overflow-hidden rounded-md border border-border"
    >
      {FPS_OPTIONS.map((fps, i) => (
        <button
          key={fps}
          type="button"
          disabled={disabled}
          aria-pressed={value === fps}
          onClick={() => onChange(fps)}
          className={clsx(
            'font-mono tabular-nums transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
            size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]',
            i > 0 && 'border-l border-border',
            value === fps ? 'bg-accent text-accent-fg' : 'bg-bg-raised text-fg-secondary hover:bg-bg-surface',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          {fps}
        </button>
      ))}
    </div>
  );
}
