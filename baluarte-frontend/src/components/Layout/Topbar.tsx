import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useUiStore } from '@/store/uiStore';
import { ROLE_LABEL } from '@/lib/roles';
import { initials } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { MenuIcon, MoonIcon, SearchIcon, SunIcon } from '@/components/icons';
import { filterPlaces, searchPlacesForRole, type NavItem } from '@/components/Sidebar/navigation';

/** Opção do painel: um local do sistema ou, por último, a busca de vulnerabilidades. */
type SearchOption = { kind: 'place'; place: NavItem } | { kind: 'vulnerabilities'; query: string };

function vulnerabilitiesPath(query: string): string {
  const q = query.trim();
  return q ? `/vulnerabilities?q=${encodeURIComponent(q)}` : '/vulnerabilities';
}

/**
 * Barra superior: menu mobile, busca global, tema e usuário.
 *
 * A busca (#27) é um combobox: ao focar (ou com Ctrl+K) abre as sugestões com os locais que o
 * perfil pode abrir — os mesmos itens do menu, lidos de `Sidebar/navigation.tsx` — e filtra por
 * nome e descrição sem diferenciar acento e maiúscula. Com texto digitado, a última opção é a
 * busca de vulnerabilidades de sempre; Enter sem opção selecionada também faz essa busca.
 */
export function Topbar() {
  const { user, hasRole } = useAuth();
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const setMobileOpen = useUiStore((s) => s.setMobileSidebarOpen);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const canSearch = hasRole('admin', 'analyst');
  const role = user?.role;

  const options = useMemo<SearchOption[]>(() => {
    const places = filterPlaces(searchPlacesForRole(role), query).map((place): SearchOption => ({
      kind: 'place',
      place,
    }));
    const q = query.trim();
    return q ? [...places, { kind: 'vulnerabilities', query: q }] : places;
  }, [role, query]);

  const expanded = open && options.length > 0;
  const optionId = (index: number) => `${listboxId}-opcao-${index}`;

  const close = () => {
    setOpen(false);
    setActiveIndex(-1);
  };

  // Ctrl+K (Cmd+K no Mac) leva o foco à busca de qualquer tela.
  useEffect(() => {
    if (!canSearch) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canSearch]);

  // Clique fora do campo e do painel fecha as sugestões.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setActiveIndex(-1);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const choose = (option: SearchOption) => {
    close();
    if (option.kind === 'place') {
      setQuery('');
      inputRef.current?.blur();
      navigate(option.place.to);
    } else {
      navigate(vulnerabilitiesPath(option.query));
    }
  };

  // Enter sem opção selecionada: o comportamento de antes (lista de vulnerabilidades filtrada).
  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    close();
    navigate(vulnerabilitiesPath(query));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = options.length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (count === 0) return;
        setOpen(true);
        setActiveIndex((current) => (!expanded ? 0 : (current + 1) % count));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (count === 0) return;
        setOpen(true);
        setActiveIndex((current) => (!expanded || current <= 0 ? count - 1 : current - 1));
        break;
      case 'Enter':
        if (expanded && activeIndex >= 0 && activeIndex < count) {
          event.preventDefault();
          choose(options[activeIndex]);
        }
        break;
      case 'Escape':
        if (expanded) {
          event.preventDefault();
          close();
        }
        break;
      default:
        break;
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:px-6">
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="rounded-md p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
        aria-label="Abrir menu"
      >
        <MenuIcon />
      </button>

      {canSearch ? (
        <form
          ref={containerRef}
          onSubmit={onSearch}
          role="search"
          className="flex min-w-0 flex-1 items-center"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
          }}
        >
          <label htmlFor="global-search" className="sr-only">
            Buscar vulnerabilidades por CVE, ativo ou categoria, ou ir para um local do sistema
          </label>
          <div className="relative w-full max-w-md">
            <SearchIcon
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              ref={inputRef}
              id="global-search"
              type="text"
              role="combobox"
              enterKeyHint="search"
              aria-expanded={expanded}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-activedescendant={expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined}
              aria-keyshortcuts="Control+K Meta+K"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                setActiveIndex(-1);
              }}
              onFocus={() => setOpen(true)}
              onClick={() => setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder="Buscar CVE, ativo, categoria OWASP…"
              className="input-base h-9 pl-9 pr-14 font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
            />
            <kbd
              aria-hidden="true"
              className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 sm:block"
            >
              Ctrl K
            </kbd>

            <ul
              id={listboxId}
              role="listbox"
              aria-label="Sugestões da busca"
              hidden={!expanded}
              data-testid="global-search-suggestions"
              className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
            >
              {options.map((option, index) => {
                const active = index === activeIndex;
                const isPlace = option.kind === 'place';
                return (
                  // Padrão combobox: o teclado fica no campo (setas/Enter/Esc via
                  // aria-activedescendant); a opção não recebe foco, só o clique do mouse.
                  // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                  <li
                    key={isPlace ? option.place.to : 'buscar-vulnerabilidades'}
                    id={optionId(index)}
                    role="option"
                    aria-selected={active}
                    // mousedown sem perder o foco do campo; o clique escolhe.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(option)}
                    onMouseMove={() => {
                      if (!active) setActiveIndex(index);
                    }}
                    className={cn(
                      'mx-1 flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left',
                      // Opção ativa: fundo + contorno interno (o foco real fica no campo).
                      active &&
                        'bg-slate-100 ring-1 ring-inset ring-slate-300 dark:bg-slate-800 dark:ring-slate-600',
                      !isPlace && 'mt-1',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    >
                      {isPlace ? option.place.icon : <SearchIcon size={16} />}
                    </span>
                    <span className="min-w-0">
                      {isPlace ? (
                        <>
                          <span className="block truncate text-sm font-medium text-ink dark:text-white">
                            {option.place.label}
                          </span>
                          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                            {option.place.description}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="block truncate text-sm font-medium text-ink dark:text-white">
                            Buscar vulnerabilidades por &lsquo;{option.query}&rsquo;
                          </span>
                          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                            CVE, ativo, programa ou categoria OWASP
                          </span>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </form>
      ) : (
        <div className="flex-1" />
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
        aria-pressed={theme === 'dark'}
        title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </Button>

      {user && (
        // Atalho para a conta: /settings e aberta a qualquer perfil (ver routes.tsx).
        <Link
          to="/settings"
          className="hidden items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 dark:hover:bg-slate-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-slate-900 sm:flex"
          data-testid="topbar-user"
          aria-label={`${user.name} (${ROLE_LABEL[user.role]}) — abrir configurações da conta`}
        >
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-ink dark:bg-slate-700 dark:text-white"
            aria-hidden="true"
          >
            {initials(user.name)}
          </span>
          <div className="leading-tight" aria-hidden="true">
            <div className="text-xs font-semibold text-ink dark:text-white">{user.name}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">{ROLE_LABEL[user.role]}</div>
          </div>
        </Link>
      )}
    </header>
  );
}
