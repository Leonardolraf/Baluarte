import { useId } from 'react';
import { cn } from '@/lib/cn';

/** Caminho do escudo com ameias (bastião). Compartilhado pelas duas metades de cor. */
const ESCUDO =
  'M8,6 L18,6 L18,12 L27,12 L27,6 L37,6 L37,12 L46,12 L46,6 L56,6 L56,12 L55,30 Q52,46 32,58 Q12,46 9,30 L8,12 Z';

export interface BaluarteMarkProps {
  /** Lado do quadrado, em px. */
  size?: number;
  className?: string;
}

/**
 * Marca do Baluarte (#25): escudo com ameias partido em duas metades de azul, com um check
 * branco de "segurança verificada". Mesmo desenho do favicon (`public/baluarte.svg`, que lá
 * mora sobre um tile escuro para ler na aba do navegador).
 *
 * A marca é COLORIDA FIXA: as cores (azul-800/azul-500, nunca navy) foram escolhidas para ler
 * tanto sobre superfícies claras quanto sobre a barra lateral escura, então não troca com o
 * tema — diferente da marca monocromática antiga, que tinha `tone`. O check branco fica dentro
 * do escudo, logo independe do fundo da página.
 *
 * Decorativa por padrão; passe `aria-label` no elemento pai quando for o único conteúdo de um
 * link.
 */
export function BaluarteMark({ size = 32, className }: BaluarteMarkProps) {
  // Id único por instância: o escudo é renderizado em vários lugares da mesma página (topbar,
  // barra lateral, login) e um id de clipPath fixo colidiria no DOM, quebrando o recorte.
  const clipId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0', className)}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="32" y="0" width="32" height="64" />
        </clipPath>
      </defs>
      <path d={ESCUDO} fill="#1e40af" />
      <path d={ESCUDO} fill="#3b82f6" clipPath={`url(#${clipId})`} />
      <path
        d="M22,33 L29,40 L44,25"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface WordmarkProps {
  /** Cor do texto: herda de `currentColor` por padrão. */
  className?: string;
  /** Linha secundária em caixa alta (ex.: "Plataforma de cibersegurança"). */
  tagline?: string;
}

/** Nome "Baluarte" em Archivo expandido, com linha secundária opcional. */
export function Wordmark({ className, tagline }: WordmarkProps) {
  return (
    <span className={cn('min-w-0 leading-none', className)}>
      <span className="display stretch-xwide block truncate text-[15px]">Baluarte</span>
      {tagline && (
        <span className="mt-1 block truncate text-[10px] font-semibold uppercase tracking-[0.14em] opacity-70">
          {tagline}
        </span>
      )}
    </span>
  );
}
