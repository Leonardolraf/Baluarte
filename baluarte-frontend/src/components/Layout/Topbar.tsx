import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useUiStore } from '@/store/uiStore';
import { ROLE_LABEL } from '@/lib/roles';
import { initials } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { MenuIcon, MoonIcon, SearchIcon, SunIcon } from '@/components/icons';

/** Barra superior: menu mobile, busca global (vulnerabilidades), tema e usuário. */
export function Topbar() {
  const { user, hasRole } = useAuth();
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const setMobileOpen = useUiStore((s) => s.setMobileSidebarOpen);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const canSearch = hasRole('admin', 'analyst');

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    navigate(q ? `/vulnerabilities?q=${encodeURIComponent(q)}` : '/vulnerabilities');
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
        <form onSubmit={onSearch} role="search" className="flex flex-1 items-center">
          <label htmlFor="global-search" className="sr-only">
            Buscar vulnerabilidades por CVE, ativo ou categoria
          </label>
          <div className="relative w-full max-w-md">
            <SearchIcon
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              id="global-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar CVE, ativo, categoria OWASP…"
              className="input-base h-9 pl-9 font-mono text-xs"
              autoComplete="off"
            />
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
        <div className="hidden items-center gap-2 sm:flex" data-testid="topbar-user">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand dark:bg-blue-950 dark:text-blue-300"
            aria-hidden="true"
          >
            {initials(user.name)}
          </span>
          <div className="leading-tight">
            <div className="text-xs font-semibold text-ink dark:text-white">{user.name}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">{ROLE_LABEL[user.role]}</div>
          </div>
        </div>
      )}
    </header>
  );
}
