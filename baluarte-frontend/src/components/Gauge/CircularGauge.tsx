import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import {
  SEVERITY_HEX,
  SEVERITY_LABEL,
  SEVERITY_PLATE_TEXT_CLASS,
  SEVERITY_TEXT_CLASS,
  severityFromRisk,
} from '@/lib/severity';

export interface CircularGaugeProps {
  /** 0–100 */
  value: number;
  label: string;
  /**
   * `tech` (risco técnico): arco contínuo — o índice é uma grandeza.
   * `human` (risco humano): 24 traços discretos — o índice é feito de pessoas.
   */
  colorScheme?: 'tech' | 'human';
  /** Força a geometria (por padrão deriva de `colorScheme`). */
  variant?: 'arc' | 'ticks';
  /** Sobre a placa escura: trilha e textos claros, independentes do tema. */
  onDark?: boolean;
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
const TICKS = 24;

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
  variant,
  onDark = false,
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
  const geometry = variant ?? (colorScheme === 'human' ? 'ticks' : 'arc');

  const center = size / 2;
  const radius = center - strokeWidth / 2 - 2;
  const trackPath = arcPath(center, center, radius, START_ANGLE, START_ANGLE + SWEEP_DEGREES);
  const arcLength = (SWEEP_DEGREES / 360) * 2 * Math.PI * radius;
  const dashOffset = arcLength * (1 - clamped / 100);
  const filledTicks = Math.round((clamped / 100) * TICKS);

  const trackClass = onDark ? 'stroke-white/15' : 'stroke-slate-200 dark:stroke-slate-800';
  const valueClass = onDark ? SEVERITY_PLATE_TEXT_CLASS[severity] : SEVERITY_TEXT_CLASS[severity];

  return (
    <figure
      className={cn('flex flex-col items-center', className)}
      data-testid="circular-gauge"
      data-color-scheme={colorScheme}
      data-variant={geometry}
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
          {geometry === 'arc' ? (
            <>
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
                className={trackClass}
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
            </>
          ) : (
            // Um traço por fatia da população: o risco humano é discreto, feito de pessoas.
            Array.from({ length: TICKS }, (_, index) => {
              const angle = START_ANGLE + ((index + 0.5) * SWEEP_DEGREES) / TICKS;
              const [x1, y1] = polar(center, center, radius - strokeWidth / 2, angle);
              const [x2, y2] = polar(center, center, radius + strokeWidth / 2, angle);
              const filled = index < filledTicks;
              return (
                <line
                  key={index}
                  x1={x1.toFixed(2)}
                  y1={y1.toFixed(2)}
                  x2={x2.toFixed(2)}
                  y2={y2.toFixed(2)}
                  strokeWidth={Math.max(3, strokeWidth * 0.3)}
                  strokeLinecap="round"
                  stroke={filled ? color : undefined}
                  className={filled ? undefined : trackClass}
                  style={{ transition: 'stroke 400ms ease-out' }}
                />
              );
            })
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('numeral text-[34px] leading-none', valueClass)}>
            {Math.round(clamped)}
            <span className="ml-0.5 font-sans text-base font-semibold">{unit}</span>
          </span>
          <span className={cn('label-caps mt-1.5', valueClass, onDark && '!text-current')}>
            {SEVERITY_LABEL[severity]}
          </span>
        </div>
      </div>
      <figcaption className="-mt-3 text-center">
        <div className={cn('text-sm font-semibold', onDark ? 'text-white' : 'text-ink dark:text-white')}>
          {label}
        </div>
        {sublabel && (
          <div
            className={cn('mt-0.5 text-xs', onDark ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400')}
          >
            {sublabel}
          </div>
        )}
      </figcaption>
    </figure>
  );
}
