import { NavLink, useNavigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';

interface NavItem {
  to: string;
  label: string;
  id: string;
  badge?: { texto: string; tom: 'normal' | 'alerta' };
}

const GRUPOS: { titulo: string; itens: NavItem[] }[] = [
  {
    titulo: 'ANÁLISE',
    itens: [
      { to: '/', label: 'Dashboard', id: 'sidebar-nav-dashboard' },
      { to: '/ativos', label: 'Ativos', id: 'sidebar-nav-ativos', badge: { texto: '12', tom: 'normal' } },
      { to: '/varreduras', label: 'Varreduras', id: 'sidebar-nav-varreduras', badge: { texto: '3', tom: 'alerta' } },
      { to: '/vulnerabilidades', label: 'Vulnerabilidades', id: 'sidebar-nav-vulnerabilidades' },
      { to: '/relatorios', label: 'Relatórios', id: 'sidebar-nav-relatorios' },
    ],
  },
  {
    titulo: 'CONSCIENTIZAÇÃO',
    itens: [
      { to: '/campanhas', label: 'Campanhas', id: 'sidebar-nav-campanhas', badge: { texto: '2', tom: 'normal' } },
      { to: '/treinamentos', label: 'Treinamentos', id: 'sidebar-nav-treinamentos' },
    ],
  },
  {
    titulo: 'ADMINISTRAÇÃO',
    itens: [
      { to: '/usuarios', label: 'Usuários', id: 'sidebar-nav-usuarios' },
      { to: '/configuracoes', label: 'Configurações', id: 'sidebar-nav-configuracoes' },
    ],
  },
];

export function Layout() {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();

  function sair() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex h-full min-h-screen">
      {/* Sidebar */}
      <aside id="sidebar" className="flex w-[220px] flex-shrink-0 flex-col bg-ink text-slate-300">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-brand text-sm font-bold text-white">B</div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">Baluarte</div>
            <div className="text-[10px] tracking-wide text-slate-400">SECURITY PLATFORM</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {GRUPOS.map((g) => (
            <div key={g.titulo} className="mb-4">
              <div className="px-3 pb-1 text-[10px] font-semibold tracking-wider text-slate-500">{g.titulo}</div>
              {g.itens.map((it) => (
                <NavLink
                  key={it.to}
                  id={it.id}
                  to={it.to}
                  end={it.to === '/'}
                  className={({ isActive }) =>
                    `flex items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                      isActive ? 'bg-brand text-white' : 'text-slate-300 hover:bg-white/5'
                    }`
                  }
                >
                  <span>{it.label}</span>
                  {it.badge && (
                    <span className={`rounded-full px-1.5 text-[11px] font-semibold ${it.badge.tom === 'alerta' ? 'bg-sev-critico text-white' : 'bg-white/10 text-slate-200'}`}>
                      {it.badge.texto}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white">
              {(usuario?.nome || 'U').slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div id="sidebar-user-name" className="truncate text-xs font-semibold text-white">{usuario?.nome}</div>
              <div id="sidebar-user-role" className="truncate text-[11px] text-slate-400">{usuario?.perfil}</div>
            </div>
            <button id="btnSair" onClick={sair} title="Sair" className="text-slate-400 hover:text-white">⎋</button>
          </div>
        </div>
      </aside>

      {/* Conteúdo */}
      <div className="flex flex-1 flex-col">
        <header id="topbar" className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-2.5">
          <div className="flex-1">
            <input
              id="input-busca-global"
              placeholder="Buscar ativos, CVEs, campanhas..."
              className="w-full max-w-md rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-brand"
            />
          </div>
          <button id="btn-notificacoes" className="relative text-slate-500 hover:text-ink" title="Notificações">
            🔔<span id="badge-notificacoes" className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-sev-critico" />
          </button>
          <button id="btn-nova-varredura" className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark">
            + Nova varredura
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
