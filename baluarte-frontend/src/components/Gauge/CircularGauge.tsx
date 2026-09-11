import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { SEVERITY_HEX, SEVERITY_LABEL, SEVERITY_TEXT_CLASS, severityFromRisk } from '@/lib/severity';

export interface CircularGaugeProps {
  /** 0–100 */
  value: number;
  label: string;
  /** Tema da trilha: `tech` (risco técnico, neutro) ou `human` (risco humano, índigo). */
  colorScheme?: 'tech' | 'human';
  /** Texto pequeno abaixo do valor (ex.: "12 vulnerabilidades abertas"). */
  sublabel?: ReactNode;
  /** Diâmetro em px. */
  size?: number;
  /** Espessura do arco. */
  strokeWidth?: number;
  /** Sufixo exibido após o valor (padrão "%"). */
  unit?: string;
  /** Inverte a semântica: valores altos são bons (ex.: resiliência). */
  higherIsBetter?: boolean;
  className?: string;
}

const SWEEP_DEGREES = 270; // gauge de 3/4 de volta (estilo velocímetro)
const START_ANGLE = 225; // 7h30 no relógio: o arco sobe pela esquerda e a abertura fica embaixo

function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [sx, sy] = polar(cx, cy, r, startDeg);
  const [ex, ey] = polar(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${sx.toFixed(3)} ${sy.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${ex.toFixed(3)} ${ey.toFixed(3)}`;
}

/** Medidor circular em SVG puro (sem dependências). role="meter" para leitores de tela. */
export function CircularGauge({
  value,
  label,
  colorScheme = 'tech',
  sublabel,
  size = 176,
  strokeWidth = 14,
  unit = '%',
  higherIsBetter = false,
  className,
}: CircularGaugeProps) {
  const id = useId();
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const risk = higherIsBetter ? 100 - clamped : clamped;
  const severity = severityFromRisk(risk);
  const color = SEVERITY_HEX[severity];

  const center = size / 2;
  const radius = center - strokeWidth / 2 - 2;
  const trackPath = arcPath(center, center, radius, START_ANGLE, START_ANGLE + SWEEP_DEGREES);
  const arcLength = (SWEEP_DEGREES / 360) * 2 * Math.PI * radius;
  const dashOffset = arcLength * (1 - clamped / 100);

  const trackColor =
    colorScheme === 'human'
      ? 'stroke-indigo-100 dark:stroke-indigo-950'
      : 'stroke-slate-200 dark:stroke-slate-800';

  return (
    <figure
      className={cn('flex flex-col items-center', className)}
      data-testid="circular-gauge"
      data-color-scheme={colorScheme}
      data-severity={severity}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(clamped)}
          aria-valuetext={`${Math.round(clamped)}${unit} — ${SEVERITY_LABEL[severity]}`}
        >
          <defs>
            <linearGradient id={`${id}-grad`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={color} stopOpacity={0.75} />
              <stop offset="100%" stopColor={color} />
            </linearGradient>
          </defs>
          <path
            d={trackPath}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            className={trackColor}
          />
          <path
            d={trackPath}
            fill="none"
            stroke={`url(#${id}-grad)`}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={arcLength}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 600ms ease-out' }}
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={cn('text-3xl font-bold tabular-nums tracking-tight', SEVERITY_TEXT_CLASS[severity])}
          >
            {Math.round(clamped)}
            <span className="text-base font-semibold">{unit}</span>
          </span>
          <span
            className={cn(
              'mt-0.5 text-[11px] font-semibold uppercase tracking-wider',
              SEVERITY_TEXT_CLASS[severity],
            )}
          >
            {SEVERITY_LABEL[severity]}
          </span>
        </div>
      </div>
      <figcaption className="-mt-4 text-center">
        <div className="text-sm font-semibold text-ink dark:text-white">{label}</div>
        {sublabel && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sublabel}</div>}
      </figcaption>
    </figure>
  );
}
