import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface EtapaFunil {
  valor: number;
  pct: number;
}

interface Treinamento {
  destinatario: string;
  concluido: boolean;
}

interface CampanhaDados {
  id: string;
  nome: string;
  template: string;
  status: string;
  destinatarios: number;
  funil: {
    enviados: EtapaFunil;
    abertos: EtapaFunil;
    clicados: EtapaFunil;
    submeteram: EtapaFunil;
    reportaram: EtapaFunil;
  };
  treinamentos: Treinamento[];
}

// ─── Etapas do funil ──────────────────────────────────────────────────────────

interface EtapaConfig {
  chave: keyof CampanhaDados['funil'];
  rotulo: string;
  corValor: string;
  corBarra: string;
}

const ETAPAS: EtapaConfig[] = [
  { chave: 'enviados',   rotulo: 'ENVIADOS',    corValor: 'text-ink',          corBarra: 'bg-[#93c5fd]' },
  { chave: 'abertos',    rotulo: 'ABERTOS',     corValor: 'text-brand',        corBarra: 'bg-brand'     },
  { chave: 'clicados',   rotulo: 'CLICADOS',    corValor: 'text-sev-alto',     corBarra: 'bg-sev-alto'  },
  { chave: 'submeteram', rotulo: 'SUBMETERAM',  corValor: 'text-sev-critico',  corBarra: 'bg-sev-critico' },
  { chave: 'reportaram', rotulo: 'REPORTARAM',  corValor: 'text-sev-baixo',    corBarra: 'bg-sev-baixo' },
];

// ─── Componente ───────────────────────────────────────────────────────────────

export function CampanhaRelatorio() {
  const { id } = useParams<{ id: string }>();
  const [dados, setDados] = useState<CampanhaDados | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!id) return;
    api
      .get(`/campanhas/${id}`)
      .then((r: { dados: CampanhaDados }) => setDados(r.dados))
      .catch((e: Error) => setErro(e.message));
  }, [id]);

  if (erro) {
    return (
      <div id="estado-erro" className="text-sev-critico">
        Erro ao carregar relatório: {erro}
      </div>
    );
  }

  if (!dados) {
    return (
      <div id="estado-carregando" className="text-slate-500">
        Carregando relatório…
      </div>
    );
  }

  const maxFunil = dados.funil.enviados.valor || 1;

  return (
    <div id="campanha-relatorio">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between">
        <div>
          <h1 id="titulo-relatorio" className="text-2xl font-bold text-ink">
            Relatório — {dados.nome}
          </h1>
          <p id="subtitulo-relatorio" className="mt-1 text-sm text-slate-500">
            {dados.template} · {dados.destinatarios} destinatários · {dados.status}
          </p>
        </div>
        <Link
          id="btn-voltar"
          to="/campanhas"
          className="rounded-lg bg-[#1e293b] px-4 py-1.5 text-sm font-medium text-white hover:bg-ink/80"
        >
          ← Menu
        </Link>
      </div>

      {/* Cards do funil */}
      <div id="cards-funil" className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {ETAPAS.map((e) => {
          const etapa = dados.funil[e.chave];
          return (
            <div
              key={e.chave}
              id={`card-funil-${e.chave}`}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {e.rotulo}
              </div>
              <div className="mt-2 text-[26px] font-bold text-ink leading-none">
                {etapa.valor}
              </div>
              <div className={`mt-2 text-xs font-semibold ${e.corValor}`}>
                {etapa.pct}%
              </div>
            </div>
          );
        })}
      </div>

      {/* Linha inferior: Funil visual + Treinamentos */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Funil de conversão (barras horizontais) */}
        <div id="card-funil-conversao" className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
          <div className="mb-4 text-sm font-semibold text-ink">Funil de conversão</div>
          <div className="space-y-4">
            {ETAPAS.map((e) => {
              const etapa = dados.funil[e.chave];
              const largura = Math.round((etapa.valor / maxFunil) * 100);
              return (
                <div key={e.chave} id={`barra-funil-${e.chave}`} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs font-medium text-slate-600 capitalize">
                    {e.chave.charAt(0).toUpperCase() + e.chave.slice(1)}
                  </span>
                  <div className="flex-1 rounded-full bg-slate-100 h-[22px]">
                    <div
                      className={`h-[22px] rounded-[6px] ${e.corBarra}`}
                      style={{ width: `${largura}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-xs font-semibold text-ink">
                    {etapa.valor}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tabela de treinamentos */}
        <div id="card-treinamentos" className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-3">
          <div className="text-sm font-semibold text-ink">
            Colaboradores redirecionados ao treinamento (US-005)
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Dados individuais visíveis apenas a Administrador e Analista (RN-006)
          </p>

          <table id="tabela-treinamentos" className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase text-slate-400">
                <th id="th-colaborador" className="pb-2 font-semibold">Colaborador</th>
                <th id="th-treinamento" className="pb-2 font-semibold text-right">Treinamento</th>
              </tr>
            </thead>
            <tbody>
              {dados.treinamentos.map((t, i) => (
                <tr
                  key={i}
                  id={`treinamento-row-${i}`}
                  className="border-t border-slate-100"
                >
                  <td className="py-2.5 font-medium text-ink">{t.destinatario}</td>
                  <td className="py-2.5 text-right">
                    {t.concluido ? (
                      <span
                        id={`badge-concluido-${i}`}
                        className="inline-flex items-center rounded-full bg-[#dcfce7] px-3 py-0.5 text-[11px] font-medium text-sev-baixo"
                      >
                        Concluído
                      </span>
                    ) : (
                      <span
                        id={`badge-pendente-${i}`}
                        className="inline-flex items-center rounded-full bg-slate-100 px-3 py-0.5 text-[11px] font-medium text-slate-500"
                      >
                        Pendente
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
