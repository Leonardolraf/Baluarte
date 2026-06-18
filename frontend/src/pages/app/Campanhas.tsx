import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

// ── Types ──────────────────────────────────────────────────────────────────────

type StatusCampanha = 'ATIVA' | 'ENCERRADA' | 'AGENDADA';

interface CampanhaItem {
  id: string;
  nome: string;
  template: string;
  status: StatusCampanha;
  destinatarios: number;
  taxaClique: number;
}

interface ResumoData {
  ativas: number;
  taxaMediaClique: number;
  colaboradoresAlcancados: number;
  resilienciaMedia: number;
}

interface CampanhasResponse {
  dados: CampanhaItem[];
  resumo: ResumoData;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

interface MetricCardProps {
  id: string;
  rotulo: string;
  valor: string | number;
  cor: string;
  rodape: string;
}

function MetricCard({ id, rotulo, valor, cor, rodape }: MetricCardProps) {
  return (
    <div id={id} className="rounded-xl border border-slate-200 bg-white p-4 flex-1 min-w-0">
      <p className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">{rotulo}</p>
      <p className={`mt-2 text-3xl font-bold ${cor}`}>{valor}</p>
      <p className="mt-2 text-xs text-slate-500">{rodape}</p>
    </div>
  );
}

const STATUS_CONFIG: Record<StatusCampanha, { label: string; bgClass: string; textClass: string }> = {
  ATIVA:      { label: 'Ativa',     bgClass: 'bg-[#dcfce7]', textClass: 'text-[#16a34a]' },
  ENCERRADA:  { label: 'Encerrada', bgClass: 'bg-slate-100',  textClass: 'text-slate-500'  },
  AGENDADA:   { label: 'Agendada',  bgClass: 'bg-[#dbeafe]',  textClass: 'text-[#2563eb]'  },
};

function StatusBadge({ status }: { status: StatusCampanha }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.ENCERRADA;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg.bgClass} ${cfg.textClass}`}>
      {cfg.label}
    </span>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function Campanhas() {
  const [dados, setDados] = useState<CampanhaItem[]>([]);
  const [resumo, setResumo] = useState<ResumoData | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api
      .get('/campanhas')
      .then((r: CampanhasResponse) => {
        setDados(r.dados);
        setResumo(r.resumo);
      })
      .catch((e: Error) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, []);

  if (carregando) {
    return (
      <div id="campanhas-loading" className="flex items-center justify-center py-20 text-slate-500 text-sm">
        Carregando campanhas…
      </div>
    );
  }

  if (erro) {
    return (
      <div id="campanhas-erro" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-sev-critico">
        Erro ao carregar campanhas: {erro}
      </div>
    );
  }

  return (
    <div id="campanhas-page">
      {/* Cabeçalho da página */}
      <div className="flex items-start justify-between">
        <div>
          <h1 id="campanhas-titulo" className="text-2xl font-bold text-ink">
            Campanhas de phishing
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Simulações controladas de phishing · rastreamento individual (RN-006)
          </p>
        </div>

        <Link
          id="btn-nova-campanha"
          to="/campanha"
          className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          + Nova campanha
        </Link>
      </div>

      {/* Cards de métricas */}
      <div id="campanhas-cards" className="mt-6 flex gap-4">
        <MetricCard
          id="card-campanhas-ativas"
          rotulo="Campanhas ativas"
          valor={resumo?.ativas ?? '—'}
          cor="text-brand"
          rodape="1 encerra em 3 dias"
        />
        <MetricCard
          id="card-taxa-media-clique"
          rotulo="Taxa média de clique"
          valor={resumo != null ? `${resumo.taxaMediaClique}%` : '—'}
          cor="text-sev-baixo"
          rodape="↓ -3% vs trimestre"
        />
        <MetricCard
          id="card-colaboradores-alcancados"
          rotulo="Colaboradores alcançados"
          valor={resumo?.colaboradoresAlcancados ?? '—'}
          cor="text-ink"
          rodape={`em ${dados.length} campanhas`}
        />
        <MetricCard
          id="card-resiliencia-media"
          rotulo="Resiliência média"
          valor={resumo != null ? `${resumo.resilienciaMedia}%` : '—'}
          cor="text-sev-alto"
          rodape="meta da empresa: 80%"
        />
      </div>

      {/* Tabela de campanhas */}
      <div id="campanhas-tabela-card" className="mt-6 rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table id="campanhas-tabela" className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-5 py-3 text-left text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                Campanha
              </th>
              <th className="px-5 py-3 text-left text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                Status
              </th>
              <th className="px-5 py-3 text-left text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                Destinatários
              </th>
              <th className="px-5 py-3 text-left text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                Taxa clique
              </th>
            </tr>
          </thead>
          <tbody>
            {dados.map((c, i) => (
              <tr
                key={c.id}
                id={`campanhas-row-${i}`}
                className="border-t border-slate-100 hover:bg-blue-50/40 transition-colors"
              >
                <td className="px-5 py-4">
                  <Link
                    id={`campanhas-link-${c.id}`}
                    to={`/campanhas/${c.id}`}
                    className="block"
                  >
                    <span className="font-medium text-ink hover:text-brand transition-colors">{c.nome}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-400">{c.template}</span>
                  </Link>
                </td>
                <td className="px-5 py-4">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-5 py-4 text-slate-600">{c.destinatarios}</td>
                <td className="px-5 py-4">
                  {c.status === 'AGENDADA' ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <span className="font-semibold text-ink">{c.taxaClique}%</span>
                  )}
                </td>
              </tr>
            ))}

            {dados.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400">
                  Nenhuma campanha encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
