import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
  /** Contador exibido ao lado do rótulo. */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  /** Aba inicial (não controlado). */
  defaultTab?: string;
  /** Aba ativa (controlado). */
  value?: string;
  onChange?: (id: string) => void;
  className?: string;
  /** Rótulo acessível do grupo de abas. */
  'aria-label'?: string;
}

/** Abas acessíveis (WAI-ARIA Tabs): setas navegam, Home/End saltam, painel inativo não é renderizado. */
export function Tabs({
  items,
  defaultTab,
  value,
  onChange,
  className,
  'aria-label': ariaLabel = 'Seções',
}: TabsProps) {
  const baseId = useId();
  const firstEnabled = items.find((t) => !t.disabled)?.id ?? items[0]?.id ?? '';
  const [internal, setInternal] = useState(defaultTab ?? firstEnabled);
  const active = value ?? internal;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = useCallback(
    (id: string) => {
      if (value === undefined) setInternal(id);
      onChange?.(id);
    },
    [onChange, value],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const enabled = items.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i >= 0);
    if (enabled.length === 0) return;
    const position = enabled.indexOf(index);
    let nextIndex: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = enabled[(position + 1) % enabled.length] ?? null;
        break;
      case 'ArrowLeft':
        nextIndex = enabled[(position - 1 + enabled.length) % enabled.length] ?? null;
        break;
      case 'Home':
        nextIndex = enabled[0] ?? null;
        break;
      case 'End':
        nextIndex = enabled[enabled.length - 1] ?? null;
        break;
      default:
        return;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const target = items[nextIndex];
    if (target) {
      select(target.id);
      tabRefs.current[nextIndex]?.focus();
    }
  };

  const activeItem = items.find((t) => t.id === active) ?? items[0];

  return (
    <div className={cn('flex flex-col', className)}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="-mb-px flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800"
      >
        {items.map((tab, index) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => select(tab.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                selected
                  ? 'border-brand text-brand dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-ink dark:text-slate-400 dark:hover:text-white',
              )}
            >
              {tab.label}
              {typeof tab.count === 'number' && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                    selected
                      ? 'bg-brand-soft text-brand dark:bg-blue-950 dark:text-blue-300'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {activeItem && (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${activeItem.id}`}
          aria-labelledby={`${baseId}-tab-${activeItem.id}`}
          tabIndex={0}
          className="animate-fade-in pt-5 focus:outline-none"
        >
          {activeItem.content}
        </div>
      )}
    </div>
  );
}
