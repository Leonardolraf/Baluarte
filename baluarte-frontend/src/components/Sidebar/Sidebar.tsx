import { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/roles';
import { useAuth } from '@/contexts/AuthContext';
import { useUiStore } from '@/store/uiStore';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, LogOutIcon } from '@/components/icons';
import { BaluarteMark, Wordmark } from '@/components/Brand/BaluarteMark';
import { navGroupsForRole } from '@/components/Sidebar/navigation';

interface SidebarContentProps {
  collapsed: boolean;
  onNavigate?: () => void;
  onToggleCollapse?: () => void;
  onClose?: () => void;
}

function SidebarContent({ collapsed, onNavigate, onToggleCollapse, onClose }: SidebarContentProps) {
  const { user, logout } = useAuth();
  const groups = navGroupsForRole(user?.role);

  return (
    <div className="flex h-full flex-col bg-ink text-slate-300">
      {/* Mesma altura da barra superior (56 px): a linha horizontal atravessa a tela inteira. */}
      <div
        className={cn(
          'flex h-14 shrink-0 items-center gap-3 border-b border-white/10 px-4',
          collapsed && 'justify-center px-2',
        )}
      >
        <BaluarteMark size={32} tone="inverse" />
        {!collapsed && <Wordmark className="text-white" tagline="Cibersegurança" />}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Fechar menu"
          >
            <CloseIcon />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Navegação principal">
        {groups.map((group) => (
          <div key={group.title} className="mb-5">
            {!collapsed && <div className="label-caps px-3 pb-1.5 !text-slate-400">{group.title}</div>}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors',
                        collapsed && 'justify-center px-2',
                        isActive
                          ? 'bg-white/10 font-medium text-white'
                          : 'text-slate-300 hover:bg-white/5 hover:text-white',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span
                            aria-hidden="true"
                            className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-white"
                          />
                        )}
                        <span className="shrink-0">{item.icon}</span>
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className={cn('flex items-center gap-2', collapsed && 'flex-col')}>
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white"
            aria-hidden="true"
          >
            {initials(user?.name)}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-xs font-semibold text-white">{user?.name}</div>
              <div className="truncate text-[11px] text-slate-400">{user ? ROLE_LABEL[user.role] : ''}</div>
            </div>
          )}
          <button
            type="button"
            onClick={() => logout()}
            className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Sair"
            title="Sair"
          >
            <LogOutIcon size={16} />
          </button>
        </div>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="mt-3 hidden w-full items-center justify-center gap-2 rounded-md py-1.5 text-xs text-slate-400 hover:bg-white/5 hover:text-white lg:flex"
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronRightIcon size={14} /> : <ChevronLeftIcon size={14} />}
            {!collapsed && <span>Recolher</span>}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Sidebar de navegação: itens por perfil, recolhível no desktop (≥ 1024 px),
 * escondida em telas menores (abre como gaveta via Topbar).
 */
export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const mobileOpen = useUiStore((s) => s.mobileSidebarOpen);
  const setMobileOpen = useUiStore((s) => s.setMobileSidebarOpen);
  const location = useLocation();

  // Fecha a gaveta ao navegar e com Escape.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, setMobileOpen]);

  // Gaveta modal: move o foco para dentro, prende Tab/Shift+Tab, fecha com Escape
  // e devolve o foco ao elemento que a abriu.
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mobileOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusables()[0]?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [mobileOpen, setMobileOpen]);

  return (
    <>
      {/* Desktop */}
      <aside
        data-testid="sidebar"
        data-collapsed={collapsed}
        className={cn(
          'hidden shrink-0 transition-[width] duration-200 lg:block',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div className="sticky top-0 h-screen">
          <SidebarContent collapsed={collapsed} onToggleCollapse={toggleSidebar} />
        </div>
      </aside>

      {/* Mobile (gaveta) */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu de navegação"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/60"
            aria-label="Fechar menu"
            onClick={() => setMobileOpen(false)}
          />
          <div
            ref={drawerRef}
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-fade-in shadow-2xl"
          >
            <SidebarContent
              collapsed={false}
              onNavigate={() => setMobileOpen(false)}
              onClose={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}
