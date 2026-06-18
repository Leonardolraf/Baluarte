import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
interface Vulnerabilidade {
  id: string;
  ativo: string;
  ativoNome: string;
  categoria: string;
  cvss: number;
  severidade: 'Crítico' | 'Alto' | 'Médio' | 'Baixo';
  status: 'Aberta' | 'Em revisao' | 'Em remediacao' | 'Resolvida';
  descricao: string;
  evidencia: string;
  detectadoEm: string;
}

interface Resumo {
  total: number;
  ativos: number;
}

interface RespostaApi {
  dados: Vulnerabilidade[];
  resumo: Resumo;
}

// ---------------------------------------------------------------------------
// Helpers de estilo
// ---------------------------------------------------------------------------
type Severidade = Vulnerabilidade['severidade'];
type StatusVuln = Vulnerabilidade['status'];

const SEV_BADGE: Record<Severidade, string> = {
  'Crítico':  'bg-red-100 text-sev-critico',
  'Alto':     'bg-orange-100 text-sev-alto',
  'Médio':    'bg-yellow-100 text-sev-medio',
  'Baixo':    'bg-green-100 text-sev-baixo',
};

const SEV_CVSS: Record<Severidade, string> = {
  'Crítico':  'text-sev-critico',
  'Alto':     'text-sev-alto',
  'Médio':    'text-sev-medio',
  'Baixo':    'text-sev-baixo',
};

const STATUS_BADGE: Record<StatusVuln, string> = {
  'Aberta':         'bg-red-100 text-sev-critico',
  'Em revisao':     'bg-yellow-100 text-sev-medio',
  'Em remediacao':  'bg-orange-100 text-[#c2410c]',
  'Resolvida':      'bg-green-100 text-sev-baixo',
};

const STATUS_LABEL: Record<StatusVuln, string> = {
  'Aberta':         'Aberta',
  'Em revisao':     'Em revisão',
  'Em remediacao':  'Em remediação',
  'Resolvida':      'Resolvida',
};

const CHIPS_SEVERIDADE = ['Todas', 'Crítico', 'Alto', 'Médio', 'Baixo'] as const;
type ChipSev = (typeof CHIPS_SEVERIDADE)[number];

const STATUS_OPCOES = [
  { value: '', label: 'Status: todos' },
  { value: 'Aberta', label: 'Aberta' },
  { value: 'Em revisao', label: 'Em revisão' },
  { value: 'Em remediacao', label: 'Em remediação' },
  { value: 'Resolvida', label: 'Resolvida' },
];

function formataData(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export function Vulnerabilidades() {
  const navigate = useNavigate();

  const [dados, setDados] = useState<Vulnerabilidade[]>([]);
  const [resumo, setResumo] = useState<Resumo>({ total: 0, ativos: 0 });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const [chipAtivo, setChipAtivo] = useState<ChipSev>('Todas');
  const [statusFiltro, setStatusFiltro] = useState('');
  const [busca, setBusca] = useState('');

  useEffect(() => {
    setCarregando(true);
    setErro('');

    const sev = chipAtivo === 'Todas' ? '' : chipAtivo;
    const params = new URLSearchParams();
    if (sev) params.set('severidade', sev);
    if (statusFiltro) params.set('status', statusFiltro);
    if (busca) params.set('q', busca);

    const query = params.toString() ? `?${params.toString()}` : '';

    api
      .get(`/vulnerabilidades${query}`)
      .then((r: RespostaApi) => {
        setDados(r.dados ?? []);
        setResumo(r.resumo ?? { total: 0, ativos: 0 });
      })
      .catch((e: Error) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, [chipAtivo, statusFiltro, busca]);

  return (
    <div>
      {/* Cabeçalho */}
      <h1 id="vuln-titulo" className="text-2xl font-bold text-ink">
        Vulnerabilidades
      </h1>
      <p id="vuln-subtitulo" className="mt-1 text-sm text-slate-500">
        {carregando
          ? 'Carregando…'
          : erro
          ? 'Erro ao carregar dados.'
          : `${resumo.total} vulnerabilidades em ${resumo.ativos} ativos`}
      </p>

      {/* Barra de filtros */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {/* Chips de severidade */}
        {CHIPS_SEVERIDADE.map((chip) => (
          <button
            key={chip}
            id={`chip-sev-${chip.toLowerCase()}`}
            onClick={() => setChipAtivo(chip)}
            className={`h-8 rounded-lg px-3.5 text-[13px] font-medium transition-colors ${
              chipAtivo === chip
                ? 'bg-brand text-white'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {chip}
          </button>
        ))}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Busca */}
        <input
          id="vuln-busca"
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar ativo, CVE…"
          className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40 w-52"
        />

        {/* Filtro de status */}
        <select
          id="vuln-filtro-status"
          value={statusFiltro}
          onChange={(e) => setStatusFiltro(e.target.value)}
          className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[12px] text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand/40 cursor-pointer"
        >
          {STATUS_OPCOES.map((op) => (
            <option key={op.value} value={op.value}>
              {op.label}
            </option>
          ))}
        </select>
      </div>

      {/* Tabela */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
        {erro && (
          <div id="vuln-erro" className="px-5 py-6 text-sm text-sev-critico">
            Erro ao carregar: {erro}
          </div>
        )}

        {!erro && (
          <table id="tabela-vulnerabilidades" className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 w-[26%]">
                  Ativo / CVE
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 w-[25%]">
                  Categoria OWASP
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 w-[8%]">
                  CVSS
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 w-[13%]">
                  Severidade
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 w-[16%]">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 w-[12%]">
                  Detectado
                </th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-400">
                    Carregando vulnerabilidades…
                  </td>
                </tr>
              ) : dados.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-400">
                    Nenhuma vulnerabilidade encontrada.
                  </td>
                </tr>
              ) : (
                dados.map((v, i) => (
                  <tr
                    key={v.id}
                    id={`vuln-row-${i}`}
                    onClick={() => navigate(`/vulnerabilidades/${v.id}`)}
                    className="border-t border-slate-100 cursor-pointer hover:bg-brand/[0.04] transition-colors"
                  >
                    {/* Ativo / CVE */}
                    <td className="px-5 py-3">
                      <Link
                        to={`/vulnerabilidades/${v.id}`}
                        id={`vuln-link-${v.id}`}
                        className="block font-medium text-ink hover:text-brand"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {v.ativoNome || v.ativo}
                      </Link>
                      <span className="text-[11px] text-slate-400">{v.ativo}</span>
                    </td>

                    {/* Categoria OWASP */}
                    <td className="px-4 py-3 text-[12px] text-slate-600">
                      {v.categoria}
                    </td>

                    {/* CVSS */}
                    <td className="px-4 py-3">
                      <span
                        id={`vuln-cvss-${v.id}`}
                        className={`text-[13px] font-semibold ${SEV_CVSS[v.severidade] ?? 'text-ink'}`}
                      >
                        {v.cvss.toFixed(1)}
                      </span>
                    </td>

                    {/* Severidade */}
                    <td className="px-4 py-3">
                      <span
                        id={`vuln-sev-${v.id}`}
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${SEV_BADGE[v.severidade] ?? 'bg-slate-100 text-slate-600'}`}
                      >
                        {v.severidade}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span
                        id={`vuln-status-${v.id}`}
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${STATUS_BADGE[v.status] ?? 'bg-slate-100 text-slate-600'}`}
                      >
                        {STATUS_LABEL[v.status] ?? v.status}
                      </span>
                    </td>

                    {/* Data */}
                    <td className="px-4 py-3 text-[12px] text-slate-500">
                      {formataData(v.detectadoEm)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
