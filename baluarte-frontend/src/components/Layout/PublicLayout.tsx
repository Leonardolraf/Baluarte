import { Link, NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useAuth } from '@/contexts/AuthContext';
import { useUiStore } from '@/store/uiStore';
import { MoonIcon, ShieldIcon, SunIcon } from '@/components/icons';
import { Button } from '@/components/ui/Button';

/** Shell público (login, redefinição de senha, sobre). */
export function PublicLayout() {
  const { isAuthenticated } = useAuth();
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'text-sm font-medium hover:text-ink dark:hover:text-white',
      isActive ? 'text-ink dark:text-white' : 'text-slate-500 dark:text-slate-400',
    );

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2" aria-label="Baluarte — início">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
              <ShieldIcon size={18} />
            </span>
            <span className="text-sm font-semibold text-ink dark:text-white">Baluarte</span>
          </Link>
          <nav className="flex items-center gap-4" aria-label="Navegação pública">
            <NavLink to="/about" className={linkClass}>
              Sobre
            </NavLink>
            <NavLink to={isAuthenticated ? '/dashboard' : '/login'} className={linkClass}>
              {isAuthenticated ? 'Ir ao dashboard' : 'Entrar'}
            </NavLink>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
              aria-pressed={theme === 'dark'}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </Button>
          </nav>
        </div>
      </header>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Baluarte · Plataforma de cibersegurança · TCC Engenharia de Software — UCB
      </footer>
    </div>
  );
}
