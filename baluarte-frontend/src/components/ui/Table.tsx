import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import type { SortDirection } from '@/types';
import {
  ArrowUpDownIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
} from '@/components/icons';
import { Button } from '@/components/ui/Button';

// Primitivos de tabela (estilo VirusTotal: denso, neutro, monoespaçado onde couber).

export interface TableContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Sem borda/sombra própria — para tabelas já dentro de um `Card`/superfície. */
  bare?: boolean;
}

export function TableContainer({ bare = false, className, children, ...rest }: TableContainerProps) {
  return (
    <div className={cn('overflow-x-auto', !bare && 'surface', className)} {...rest}>
      {children}
    </div>
  );
}

export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table className={cn('w-full min-w-[640px] border-collapse text-left text-sm', className)} {...rest}>
      {children}
    </table>
  );
}

export function THead({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn('bg-slate-50 dark:bg-slate-800/60', className)} {...rest}>
      {children}
    </thead>
  );
}

export function TBody({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={cn('divide-y divide-slate-100 dark:divide-slate-800', className)} {...rest}>
      {children}
    </tbody>
  );
}

export interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** Quando informado, o cabeçalho vira botão de ordenação. */
  sortable?: boolean;
  sorted?: SortDirection | null;
  onSort?: () => void;
  align?: 'left' | 'right' | 'center';
}

export function Th({ sortable, sorted, onSort, align = 'left', className, children, ...rest }: ThProps) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  const ariaSort = sortable
    ? sorted === 'asc'
      ? 'ascending'
      : sorted === 'desc'
        ? 'descending'
        : 'none'
    : undefined;
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn('label-caps whitespace-nowrap px-4 py-2.5', alignClass, className)}
      {...rest}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            'inline-flex items-center gap-1 rounded hover:text-ink dark:hover:text-white',
            sorted && 'text-ink dark:text-white',
          )}
        >
          {children}
          {sorted === 'asc' ? (
            <ChevronUpIcon size={12} />
          ) : sorted === 'desc' ? (
            <ChevronDownIcon size={12} />
          ) : (
            <ArrowUpDownIcon size={12} className="opacity-50" />
          )}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  align?: 'left' | 'right' | 'center';
  mono?: boolean;
}

export function Td({ align = 'left', mono, className, children, ...rest }: TdProps) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <td
      className={cn(
        'px-4 py-3 align-middle text-slate-700 dark:text-slate-200',
        alignClass,
        mono && 'font-mono text-xs',
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  /**
   * Linha clicável para mouse (cursor + hover + `onClick`). A linha NÃO recebe foco:
   * a navegação acessível deve ficar num `<Link>` na célula principal, que dá
   * nome, papel e destino ao leitor de tela.
   */
  interactive?: boolean;
}

export function Tr({ interactive, className, children, ...rest }: TableRowProps) {
  return (
    <tr
      className={cn(
        'transition-colors',
        interactive && 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60',
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

/** Paginação client-side. `page` começa em 1. */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50],
  className,
}: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const start = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const end = Math.min(total, current * pageSize);

  return (
    <nav
      aria-label="Paginação"
      className={cn(
        'flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span>
          Exibindo{' '}
          <strong className="text-ink dark:text-white">
            {start}–{end}
          </strong>{' '}
          de <strong className="text-ink dark:text-white">{total}</strong>
        </span>
        {onPageSizeChange && (
          <label className="flex items-center gap-2 text-xs">
            <span className="sr-only sm:not-sr-only">Por página</span>
            <select
              aria-label="Itens por página"
              className="input-base h-8 w-auto py-0 text-xs"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(current - 1)}
          disabled={current <= 1}
          aria-label="Página anterior"
          leftIcon={<ChevronLeftIcon size={14} />}
        >
          Anterior
        </Button>
        <span className="tabular-nums" aria-live="polite">
          {current} / {pages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(current + 1)}
          disabled={current >= pages}
          aria-label="Próxima página"
          rightIcon={<ChevronRightIcon size={14} />}
        >
          Próxima
        </Button>
      </div>
    </nav>
  );
}

export function TableEmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
        {children}
      </td>
    </tr>
  );
}
