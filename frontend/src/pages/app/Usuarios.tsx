import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

// ── Tipos ──────────────────────────────────────────────────────────────────────

type Perfil = 'Administrador' | 'Analista' | 'Colaborador';
type Status = 'Ativo' | 'Inativo' | 'Pendente';

interface Usuario {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  status: Status;
  criadoEm: string;
}

interface Resumo {
  total: number;
  Administrador: number;
  Analista: number;
  Colaborador: number;
}

interface UsuariosResposta {
  dados: Usuario[];
  resumo: Resumo;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function labelContagem(n: number): string {
  return n === 1 ? '1 usuário' : `${n} usuários`;
}

// ── Sub-componentes ────────────────────────────────────────────────────────────

function BadgePerfil({ perfil }: { perfil: Perfil }) {
  if (perfil === 'Administrador') {
    return (
      <span className="inline-block rounded-full bg-[#dbeafe] px-2 py-0.5 text-[11px] font-medium text-[#2563eb]">
        Administrador
      </span>
    );
  }
  if (perfil === 'Analista') {
    return (
      <span className="inline-block rounded-full bg-[#ede9fe] px-2 py-0.5 text-[11px] font-medium text-[#7c3aed]">
        Analista de Segurança
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-medium text-[#475569]">
      Colaborador
    </span>
  );
}

function BadgeStatus({ status }: { status: Status }) {
  if (status === 'Ativo') {
    return (
      <span className="inline-block rounded-full bg-[#dcfce7] px-2 py-0.5 text-[11px] font-medium text-[#16a34a]">
        Ativo
      </span>
    );
  }
  if (status === 'Inativo') {
    return (
      <span className="inline-block rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-medium text-[#64748b]">
        Inativo
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full bg-[#fef9c3] px-2 py-0.5 text-[11px] font-medium text-[#a16207]">
      Pendente
    </span>
  );
}

// ── Componente principal ────────────────────────────────────────────────────────

export function Usuarios() {
  const [dados, setDados] = useState<Usuario[]>([]);
  const [resumo, setResumo] = useState<Resumo>({ total: 0, Administrador: 0, Analista: 0, Colaborador: 0 });
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    setCarregando(true);
    api
      .get('/usuarios')
      .then((r: UsuariosResposta) => {
        setDados(r.dados);
        setResumo(r.resumo);
      })
      .catch((e: Error) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, []);

  const listagem = dados.filter((u) => {
    const q = busca.toLowerCase();
    return u.nome.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  if (erro) {
    return (
      <div id="usuarios-erro" className="py-8 text-center text-sm text-sev-critico">
        Erro ao carregar usuários: {erro}
      </div>
    );
  }

  return (
    <div id="usuarios-page">
      {/* Cabeçalho da página */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 id="usuarios-titulo" className="text-2xl font-bold text-ink">
            Usuários e perfis de acesso
          </h1>
          <p id="usuarios-subtitulo" className="mt-1 text-sm text-slate-500">
            Controle de acesso baseado em papéis (RBAC)
            {resumo.total > 0 && <> · {resumo.total} contas</>}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Campo de busca */}
          <input
            id="usuarios-busca"
            type="text"
            placeholder="Buscar usuários por nome ou e-mail..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-[34px] w-72 rounded-lg border border-slate-200 bg-[#f1f5f9] px-3 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
          {/* Botão convidar */}
          <Link
            id="btn-convidar-usuario"
            to="/cadastro-usuario"
            className="inline-flex h-[34px] items-center rounded-lg bg-brand px-4 text-[13px] font-semibold text-white hover:bg-[#1d4ed8] transition-colors"
          >
            + Convidar usuário
          </Link>
        </div>
      </div>

      {/* Cards de perfil */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Card Administrador */}
        <div
          id="card-perfil-administrador"
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <span className="inline-block rounded-full bg-[#dbeafe] px-2.5 py-0.5 text-[11px] font-medium text-[#2563eb]">
            Administrador
          </span>
          <p className="mt-3 text-[12px] font-semibold text-ink">
            {carregando ? '—' : labelContagem(resumo.Administrador)}
          </p>
          <p className="mt-1 text-[12px] text-slate-500">
            Acesso total: gerencia usuários, ativos, varreduras, campanhas e configurações.
          </p>
        </div>

        {/* Card Analista */}
        <div
          id="card-perfil-analista"
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <span className="inline-block rounded-full bg-[#ede9fe] px-2.5 py-0.5 text-[11px] font-medium text-[#7c3aed]">
            Analista de Segurança
          </span>
          <p className="mt-3 text-[12px] font-semibold text-ink">
            {carregando ? '—' : labelContagem(resumo.Analista)}
          </p>
          <p className="mt-1 text-[12px] text-slate-500">
            Opera varreduras, dashboard e campanhas. Sem gestão de usuários.
          </p>
        </div>

        {/* Card Colaborador */}
        <div
          id="card-perfil-colaborador"
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <span className="inline-block rounded-full bg-[#f1f5f9] px-2.5 py-0.5 text-[11px] font-medium text-[#475569]">
            Colaborador
          </span>
          <p className="mt-3 text-[12px] font-semibold text-ink">
            {carregando ? '—' : labelContagem(resumo.Colaborador)}
          </p>
          <p className="mt-1 text-[12px] text-slate-500">
            Acessa apenas o treinamento pós-clique e o próprio histórico (RN-006).
          </p>
        </div>
      </div>

      {/* Tabela de usuários */}
      <div id="card-tabela-usuarios" className="rounded-xl border border-slate-200 bg-white">
        {carregando ? (
          <div className="py-10 text-center text-sm text-slate-500">Carregando usuários…</div>
        ) : (
          <table id="tabela-usuarios" className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Nome
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  E-mail
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Perfil
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Status
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Criado em
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {listagem.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-slate-400">
                    {busca ? 'Nenhum usuário encontrado para esta busca.' : 'Nenhum usuário cadastrado.'}
                  </td>
                </tr>
              ) : (
                listagem.map((u, i) => (
                  <tr
                    key={u.id}
                    id={`tabela-usuario-row-${i}`}
                    data-usuario-id={u.id}
                    className="border-t border-slate-100 hover:bg-slate-50 transition-colors"
                  >
                    {/* Avatar + Nome */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          id={`usuario-avatar-${i}`}
                          className="inline-flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg bg-[#e2e8f0] text-[11px] font-semibold text-[#475569]"
                        >
                          {iniciais(u.nome)}
                        </span>
                        <span id={`usuario-nome-${i}`} className="font-medium text-ink">
                          {u.nome}
                        </span>
                      </div>
                    </td>

                    {/* E-mail */}
                    <td id={`usuario-email-${i}`} className="px-4 py-3 text-[12px] text-slate-500">
                      {u.email}
                    </td>

                    {/* Perfil */}
                    <td id={`usuario-perfil-${i}`} className="px-4 py-3">
                      <BadgePerfil perfil={u.perfil} />
                    </td>

                    {/* Status */}
                    <td id={`usuario-status-${i}`} className="px-4 py-3">
                      <BadgeStatus status={u.status} />
                    </td>

                    {/* Criado em */}
                    <td id={`usuario-criado-${i}`} className="px-4 py-3 text-[12px] text-slate-400">
                      {new Date(u.criadoEm).toLocaleDateString('pt-BR')}
                    </td>

                    {/* Ações */}
                    <td className="px-4 py-3 text-right">
                      <button
                        id={`usuario-menu-${i}`}
                        aria-label={`Ações para ${u.nome}`}
                        className="text-[14px] font-bold text-slate-400 hover:text-slate-600"
                      >
                        •••
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Nota RN-002 */}
      <p id="aviso-rn002" className="mt-4 text-[12px] text-slate-400">
        ⚠ O sistema impede a remoção ou desativação do último Administrador ativo (RN-002).
      </p>
    </div>
  );
}
