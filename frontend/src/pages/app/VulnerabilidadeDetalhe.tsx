import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';

interface VulnerabilidadeDados {
  id: string;
  ativo: string;
  ativoNome: string;
  categoria: string;
  cvss: number;
  severidade: string;
  status: string;
  descricao: string;
  evidencia: string;
  detectadoEm: string;
}

const COR_SEV: Record<string, { texto: string; fundo: string }> = {
  'Crítico': { texto: 'text-sev-critico', fundo: 'bg-sev-critico/10' },
  'Alto':    { texto: 'text-sev-alto',    fundo: 'bg-sev-alto/10' },
  'Médio':   { texto: 'text-sev-medio',   fundo: 'bg-sev-medio/10' },
  'Baixo':   { texto: 'text-sev-baixo',   fundo: 'bg-sev-baixo/10' },
};

const STATUS_OPCOES = [
  { value: 'Aberta',          label: 'Aberta' },
  { value: 'Em revisão',      label: 'Em revisão' },
  { value: 'Em remediação',   label: 'Em remediação' },
  { value: 'Resolvida',       label: 'Resolvida' },
];

export function VulnerabilidadeDetalhe() {
  const { id } = useParams<{ id: string }>();
  const [dados, setDados] = useState<VulnerabilidadeDados | null>(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.get(`/vulnerabilidades/${id}`)
      .then((r) => setDados(r.dados))
      .catch((e: Error) => setErro(e.message));
  }, [id]);

  async function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (!dados || !id) return;
    const novoStatus = e.target.value;
    setSalvando(true);
    try {
      await api.patch(`/vulnerabilidades/${id}`, { status: novoStatus });
      setDados((prev) => prev ? { ...prev, status: novoStatus } : prev);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (erro) {
    return (
      <div id="vuln-detalhe-erro" className="rounded-xl border border-slate-200 bg-white p-6 text-sev-critico">
        Erro ao carregar: {erro}
      </div>
    );
  }

  if (!dados) {
    return (
      <div id="vuln-detalhe-carregando" className="text-slate-500">
        Carregando vulnerabilidade…
      </div>
    );
  }

  const sev = COR_SEV[dados.severidade] ?? { texto: 'text-slate-600', fundo: 'bg-slate-100' };

  const detectadoFormatado = dados.detectadoEm
    ? new Date(dados.detectadoEm).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '—';

  return (
    <div id="vuln-detalhe-root">
      {/* Breadcrumb */}
      <nav id="vuln-detalhe-breadcrumb" className="flex items-center gap-1 text-[13px]">
        <Link to="/vulnerabilidades" className="font-medium text-brand hover:underline">
          Vulnerabilidades
        </Link>
        <span className="text-slate-400">&rsaquo;</span>
        <span className="text-slate-400">{dados.categoria} · {dados.ativo}</span>
      </nav>

      {/* Título */}
      <h1 id="vuln-detalhe-titulo" className="mt-2 text-[22px] font-bold text-ink">
        {dados.categoria} — {dados.ativoNome}
      </h1>

      {/* Badges */}
      <div id="vuln-detalhe-badges" className="mt-3 flex flex-wrap items-center gap-2">
        <span
          id="badge-severidade"
          className={`rounded-full px-3 py-0.5 text-[11px] font-medium ${sev.texto} ${sev.fundo}`}
        >
          {dados.severidade}
        </span>
        <span
          id="badge-cvss"
          className="rounded-full bg-ink px-3 py-0.5 text-[11px] font-semibold text-white"
        >
          CVSS {dados.cvss.toFixed(1)}
        </span>
        <span
          id="badge-status"
          className={`rounded-full px-3 py-0.5 text-[11px] font-medium ${sev.texto} ${sev.fundo}`}
        >
          {dados.status}
        </span>
      </div>

      {/* Corpo — duas colunas */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_344px]">

        {/* Coluna esquerda */}
        <div className="flex flex-col gap-5">

          {/* Card Descrição */}
          <div id="card-descricao" className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-[14px] font-semibold text-ink">Descrição</h2>
            <p id="vuln-descricao-texto" className="mt-3 text-[13px] leading-relaxed text-slate-600">
              {dados.descricao}
            </p>
          </div>

          {/* Card Evidência */}
          <div id="card-evidencia" className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-[14px] font-semibold text-ink">Evidência</h2>
            <pre
              id="vuln-evidencia-mono"
              className="mt-3 overflow-x-auto rounded-lg bg-ink p-4 text-[12px] leading-relaxed text-slate-200 font-mono whitespace-pre-wrap"
            >
              {dados.evidencia}
            </pre>
          </div>

        </div>

        {/* Coluna direita */}
        <div className="flex flex-col gap-5">

          {/* Card Detalhes técnicos */}
          <div id="card-detalhes-tecnicos" className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-[14px] font-semibold text-ink">Detalhes técnicos</h2>

            <dl className="mt-3 space-y-3">
              <div id="detalhe-cvss">
                <dt className="text-[12px] text-slate-400">CVSS v3.1</dt>
                <dd className="text-[13px] font-medium text-ink">
                  {dados.cvss.toFixed(1)} · {dados.severidade}
                </dd>
              </div>
              <div id="detalhe-categoria">
                <dt className="text-[12px] text-slate-400">Categoria</dt>
                <dd className="text-[13px] font-medium text-ink">{dados.categoria}</dd>
              </div>
              <div id="detalhe-ativo">
                <dt className="text-[12px] text-slate-400">Ativo</dt>
                <dd className="text-[13px] font-medium text-ink">{dados.ativoNome}</dd>
              </div>
              <div id="detalhe-detectado">
                <dt className="text-[12px] text-slate-400">Detectado</dt>
                <dd className="text-[13px] font-medium text-ink">{detectadoFormatado}</dd>
              </div>
            </dl>
          </div>

          {/* Card Status */}
          <div id="card-status" className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-[14px] font-semibold text-ink">Status &amp; responsável</h2>

            <div className="mt-3">
              <label htmlFor="select-status" className="sr-only">Status da vulnerabilidade</label>
              <select
                id="select-status"
                value={dados.status}
                onChange={handleStatusChange}
                disabled={salvando}
                className={`w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-medium outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60 ${sev.texto}`}
              >
                {STATUS_OPCOES.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
              {salvando && (
                <p className="mt-1 text-[11px] text-slate-400">Salvando…</p>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Botão voltar */}
      <div className="mt-6">
        <Link
          id="btn-voltar"
          to="/vulnerabilidades"
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-[13px] font-medium text-white hover:bg-slate-700"
        >
          ← Voltar
        </Link>
      </div>
    </div>
  );
}
