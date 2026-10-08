import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { RiskTrendPoint, Severity } from '@/types';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import { SEVERITY_DOT_CLASS, SEVERITY_HEX, SEVERITY_LABEL } from '@/lib/severity';

// Evolução do risco nos últimos 30 dias (B25b). SVG próprio, sem biblioteca de gráficos (o
// frontend não usa nenhuma). Dois painéis com o mesmo eixo de dias, cada um com UM eixo y:
// o índice (0–100) e as vulnerabilidades abertas por severidade (contagem). Os números vêm
// prontos do servidor (o índice inclusive); aqui só se desenha.
// Acessibilidade: resumo em texto, legenda (identidade nunca só pela cor), dica ao passar o
// mouse ou com as setas do teclado (papel de slider, que anuncia o dia) e a tabela com todos os dias.
// O SVG é desenhado na largura real do contêiner (sem escalar o texto em tela larga ou estreita).

export interface RiskTrendChartProps {
  points: RiskTrendPoint[];
  className?: string;
}

const SERIES: Array<{ key: Severity & keyof RiskTrendPoint; severity: Severity }> = [
  { key: 'critical', severity: 'critical' },
  { key: 'high', severity: 'high' },
  { key: 'medium', severity: 'medium' },
  { key: 'low', severity: 'low' },
];

/** Largura antes da primeira medição (e nos testes, sem ResizeObserver). */
const DEFAULT_WIDTH = 600;
const H = 140;
const PAD = { left: 30, right: 10, top: 8, bottom: 22 };
const PLOT_H = H - PAD.top - PAD.bottom;

/** "2026-10-08" -> "08/10" (sem passar por Date: a data já é do dia local do servidor). */
function dayLabel(date: string): string {
  const [, month = '', day = ''] = date.split('-');
  return `${day}/${month}`;
}

/** "2026-10-08" -> "08/10/2026". */
function fullDate(date: string): string {
  const [year = '', month = '', day = ''] = date.split('-');
  return `${day}/${month}/${year}`;
}

/** Topo do eixo de contagem: múltiplo "redondo" acima do máximo (pelo menos 4). */
function niceMax(max: number): number {
  if (max <= 4) return 4;
  const step = max <= 10 ? 2 : max <= 50 ? 10 : Math.pow(10, Math.floor(Math.log10(max)));
  return Math.ceil(max / step) * step;
}

function plotWidth(w: number): number {
  return Math.max(1, w - PAD.left - PAD.right);
}

function xAt(i: number, n: number, w: number): number {
  return PAD.left + (n <= 1 ? plotWidth(w) / 2 : (i / (n - 1)) * plotWidth(w));
}

function yAt(value: number, max: number): number {
  return PAD.top + PLOT_H - (Math.max(0, value) / max) * PLOT_H;
}

function path(values: number[], max: number, w: number): string {
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${xAt(i, values.length, w).toFixed(1)},${yAt(v, max).toFixed(1)}`)
    .join(' ');
}

function signed(n: number): string {
  return n > 0 ? `+${formatNumber(n)}` : n < 0 ? `−${formatNumber(Math.abs(n))}` : 'sem variação';
}

function openOf(p: RiskTrendPoint): number {
  return p.critical + p.high + p.medium + p.low;
}

interface PanelProps {
  width: number;
  title: string;
  max: number;
  ticks: number[];
  points: RiskTrendPoint[];
  active: number | null;
  onPointer: (event: MouseEvent<SVGSVGElement>) => void;
  onLeave: () => void;
  lines: Array<{ id: string; values: number[]; stroke?: string; className?: string }>;
  testId: string;
}

function Panel({ width, title, max, ticks, points, active, onPointer, onLeave, lines, testId }: PanelProps) {
  const n = points.length;
  const labelIdx = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, all) => all.indexOf(v) === i);
  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">{title}</figcaption>
      <svg
        viewBox={`0 0 ${width} ${H}`}
        className="block h-auto w-full touch-none select-none overflow-visible"
        aria-hidden="true"
        data-testid={testId}
        onMouseMove={onPointer}
        onMouseLeave={onLeave}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={yAt(t, max)}
              y2={yAt(t, max)}
              className="stroke-slate-200 dark:stroke-slate-800"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={yAt(t, max)}
              dy="0.32em"
              textAnchor="end"
              className="fill-slate-500 text-[10px] tabular-nums dark:fill-slate-400"
            >
              {formatNumber(t)}
            </text>
          </g>
        ))}
        {labelIdx.map((i) => (
          <text
            key={i}
            x={xAt(i, n, width)}
            y={H - 6}
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            className="fill-slate-500 text-[10px] tabular-nums dark:fill-slate-400"
          >
            {dayLabel(points[i]!.date)}
          </text>
        ))}
        {active !== null && (
          <line
            x1={xAt(active, n, width)}
            x2={xAt(active, n, width)}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            className="stroke-slate-400 dark:stroke-slate-500"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
        {lines.map((l) => (
          <path
            key={l.id}
            d={path(l.values, max, width)}
            fill="none"
            stroke={l.stroke ?? 'currentColor'}
            className={l.className}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            data-series={l.id}
          />
        ))}
        {active !== null &&
          lines.map((l) => (
            <circle
              key={l.id}
              cx={xAt(active, n, width)}
              cy={yAt(l.values[active] ?? 0, max)}
              r={4}
              fill={l.stroke ?? 'currentColor'}
              className={cn('stroke-white dark:stroke-slate-900', l.className)}
              strokeWidth={2}
            />
          ))}
      </svg>
    </figure>
  );
}

export function RiskTrendChart({ points, className }: RiskTrendChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      if (el.clientWidth > 0) setWidth(Math.round(el.clientWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const n = points.length;
  if (n === 0) return null;

  const first = points[0]!;
  const last = points[n - 1]!;
  const countMax = niceMax(Math.max(...points.map((p) => Math.max(p.critical, p.high, p.medium, p.low))));
  const countTicks = [0, countMax / 2, countMax];
  const shown = active === null ? null : points[active]!;

  const onPointer = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const i = Math.round(((x - PAD.left) / plotWidth(width)) * (n - 1));
    setActive(Math.max(0, Math.min(n - 1, i)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const step = event.key === 'ArrowLeft' ? -1 : 1;
      setActive((cur) => Math.max(0, Math.min(n - 1, (cur ?? n - 1) + (cur === null ? 0 : step))));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(n - 1);
    } else if (event.key === 'Escape') {
      setActive(null);
    }
  };

  const describe = (p: RiskTrendPoint) =>
    `${fullDate(p.date)}: índice ${formatNumber(p.index)} de 100; ${formatNumber(openOf(p))} abertas ` +
    `(${SERIES.map((s) => `${formatNumber(p[s.key])} ${SEVERITY_LABEL[s.severity].toLowerCase()}`).join(', ')})` +
    (p.maliciousFiles > 0 ? `; ${formatNumber(p.maliciousFiles)} arquivo(s) com ameaça` : '');

  return (
    <div className={cn('space-y-4', className)} data-testid="risk-trend">
      <p className="text-sm text-slate-700 dark:text-slate-300" data-testid="risk-trend-summary">
        Índice hoje:{' '}
        <span className="font-semibold tabular-nums text-ink dark:text-white">
          {formatNumber(last.index)}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">/100</span> ·{' '}
        {signed(last.index - first.index)} desde {dayLabel(first.date)} · {formatNumber(openOf(last))}{' '}
        {openOf(last) === 1 ? 'vulnerabilidade aberta' : 'vulnerabilidades abertas'} hoje (
        {signed(openOf(last) - openOf(first))})
      </p>

      <ul
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300"
        aria-label="Legenda"
      >
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-0.5 w-4 rounded-full bg-slate-800 dark:bg-slate-100" />
          Índice de risco técnico
        </li>
        {SERIES.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn('h-0.5 w-4 rounded-full', SEVERITY_DOT_CLASS[s.severity])}
            />
            {SEVERITY_LABEL[s.severity]}
          </li>
        ))}
      </ul>
      <div
        // Percorrer os dias com o teclado é escolher um valor num intervalo: o papel de slider
        // anuncia o dia escolhido (aria-valuetext) sem região viva extra.
        ref={box}
        role="slider"
        tabIndex={0}
        aria-label="Dia da evolução do risco (setas percorrem os 30 dias; a tabela abaixo tem todos os dados)"
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuenow={(active ?? n - 1) + 1}
        aria-valuetext={describe(points[active ?? n - 1]!)}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        className="focus-visible:ring-brand-500 relative rounded-lg outline-none focus-visible:ring-2"
      >
        <Panel
          width={width}
          title="Índice de risco técnico (0 a 100)"
          max={100}
          ticks={[0, 50, 100]}
          points={points}
          active={active}
          onPointer={onPointer}
          onLeave={() => setActive(null)}
          lines={[
            {
              id: 'index',
              values: points.map((p) => p.index),
              className: 'text-slate-800 dark:text-slate-100',
            },
          ]}
          testId="risk-trend-index"
        />
        <div className="mt-3">
          <Panel
            width={width}
            title="Vulnerabilidades abertas por severidade"
            max={countMax}
            ticks={countTicks}
            points={points}
            active={active}
            onPointer={onPointer}
            onLeave={() => setActive(null)}
            lines={SERIES.map((s) => ({
              id: s.key,
              values: points.map((p) => p[s.key]),
              stroke: SEVERITY_HEX[s.severity],
            }))}
            testId="risk-trend-severity"
          />
        </div>

        {shown && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-56 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
            style={{
              left: `clamp(0px, calc(${(xAt(active!, n, width) / width) * 100}% - 7rem), calc(100% - 14rem))`,
            }}
            data-testid="risk-trend-tooltip"
          >
            <p className="font-medium text-ink dark:text-white">{fullDate(shown.date)}</p>
            <p className="mt-1 flex justify-between text-slate-600 dark:text-slate-300">
              Índice{' '}
              <span className="font-semibold tabular-nums text-ink dark:text-white">
                {formatNumber(shown.index)}
              </span>
            </p>
            <ul className="mt-1 space-y-0.5">
              {SERIES.map((s) => (
                <li
                  key={s.key}
                  className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-300"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={cn('h-2 w-2 rounded-full', SEVERITY_DOT_CLASS[s.severity])}
                    />
                    {SEVERITY_LABEL[s.severity]}
                  </span>
                  <span className="tabular-nums text-ink dark:text-white">{formatNumber(shown[s.key])}</span>
                </li>
              ))}
            </ul>
            {shown.maliciousFiles > 0 && (
              <p className="mt-1 text-slate-500 dark:text-slate-400">
                + {formatNumber(shown.maliciousFiles)} {shown.maliciousFiles === 1 ? 'arquivo' : 'arquivos'}{' '}
                com ameaça
              </p>
            )}
          </div>
        )}
      </div>

      <details className="text-xs text-slate-600 dark:text-slate-400">
        <summary className="cursor-pointer select-none font-medium text-slate-700 hover:underline dark:text-slate-300">
          Ver os 30 dias em tabela
        </summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-left tabular-nums" data-testid="risk-trend-table">
            <caption className="sr-only">Evolução do risco técnico por dia</caption>
            <thead className="sticky top-0 bg-white dark:bg-slate-900">
              <tr>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Dia
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">
                  Índice
                </th>
                {SERIES.map((s) => (
                  <th key={s.key} scope="col" className="py-1 pr-2 text-right font-medium">
                    {SEVERITY_LABEL[s.severity]}
                  </th>
                ))}
                <th scope="col" className="py-1 pr-2 text-right font-medium">
                  Arquivos com ameaça
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Ativos
                </th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.date} className="border-t border-slate-100 dark:border-slate-800">
                  <th scope="row" className="py-1 pr-2 font-normal">
                    {fullDate(p.date)}
                  </th>
                  <td className="py-1 pr-2 text-right">{formatNumber(p.index)}</td>
                  {SERIES.map((s) => (
                    <td key={s.key} className="py-1 pr-2 text-right">
                      {formatNumber(p[s.key])}
                    </td>
                  ))}
                  <td className="py-1 pr-2 text-right">{formatNumber(p.maliciousFiles)}</td>
                  <td className="py-1 text-right">{formatNumber(p.assets)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
