import { useEffect, useState } from 'react';
import { api } from '../api';

interface DashboardDados {
  kpis: { vulnerabilidadesAbertas: number; criticas: number; resilienciaPhishing: number; ativosMonitorados: number };
  distribuicaoSeveridade: Record<string, number>;
  vulnerabilidadesRecentes: { id: string; ativo: string; categoria: string; cvss: number; severidade: string; status: string }[];
  campanhas: { id: string; nome: string; status: string; destinatarios: number; taxaClique: number }[];
  funil: Record<string, { valor: number; pct: number }> | null;
}

const CORES_SEV: Record<string, string> = { 'Crítico': 'bg-sev-critico', 'Alto': 'bg-sev-alto', 'Médio': 'bg-sev-medio', 'Baixo': 'bg-sev-baixo' };

function Kpi({ id, rotulo, valor, cor }: { id: string; rotulo: string; valor: string | number; cor?: string }) {
  return (
    <div id={id} className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium text-slate-500">{rotulo}</div>
      <div className={`mt-1 text-2xl font-bold ${cor ?? 'text-ink'}`}>{valor}</div>
    </div>
  );
}

export function Dashboard() {
  const [d, setD] = useState<DashboardDados | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api.get('/dashboard').then((r) => setD(r.dados)).catch((e) => setErro(e.message));
  }, []);

  if (erro) return <div className="text-sev-critico">Erro ao carregar: {erro}</div>;
  if (!d) return <div className="text-slate-500">Carregando dashboard…</div>;

  const maxSev = Math.max(1, ...Object.values(d.distribuicaoSeveridade));

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">Visão geral de risco</h1>
      <p className="mt-1 text-sm text-slate-500">Consolidação de risco técnico e humano da organização.</p>

      {/* KPIs */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi id="kpi-vulnerabilidades-abertas" rotulo="Vulnerabilidades abertas" valor={d.kpis.vulnerabilidadesAbertas} cor="text-sev-critico" />
        <Kpi id="kpi-criticas" rotulo="Críticas (CVSS ≥ 9.0)" valor={d.kpis.criticas} cor="text-sev-critico" />
        <Kpi id="kpi-resiliencia-phishing" rotulo="Resiliência a phishing" valor={`${d.kpis.resilienciaPhishing}%`} cor="text-sev-medio" />
        <Kpi id="kpi-ativos-monitorados" rotulo="Ativos monitorados" valor={d.kpis.ativosMonitorados} cor="text-sev-baixo" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Tabela de vulnerabilidades recentes */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-ink">Vulnerabilidades recentes</div>
            <table id="tabela-vulnerabilidades" className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-2 font-medium">ATIVO</th>
                  <th className="px-4 py-2 font-medium">CATEGORIA</th>
                  <th className="px-4 py-2 font-medium">CVSS</th>
                  <th className="px-4 py-2 font-medium">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {d.vulnerabilidadesRecentes.map((v, i) => (
                  <tr key={v.id} id={`tabela-vuln-row-${i}`} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium text-ink">{v.ativo}</td>
                    <td className="px-4 py-2 text-slate-600">{v.categoria}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold text-white ${CORES_SEV[v.severidade] ?? 'bg-slate-400'}`}>{v.cvss.toFixed(1)}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{v.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Distribuição por severidade */}
        <div id="card-distribuicao-severidade" className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-ink">Distribuição por severidade</div>
          <div className="mt-3 space-y-3">
            {['Crítico', 'Alto', 'Médio', 'Baixo'].map((nivel) => (
              <div key={nivel}>
                <div className="flex justify-between text-xs text-slate-600">
                  <span>{nivel}</span>
                  <span>{d.distribuicaoSeveridade[nivel] ?? 0}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100">
                  <div className={`h-2 rounded-full ${CORES_SEV[nivel]}`} style={{ width: `${((d.distribuicaoSeveridade[nivel] ?? 0) / maxSev) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Funil de campanha */}
      {d.funil && (
        <div id="card-funil-campanha" className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-ink">Funil da campanha ativa</div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ['funil-enviados', 'Enviados', d.funil.enviados],
              ['funil-abertos', 'Abertos', d.funil.abertos],
              ['funil-clicados', 'Clicados', d.funil.clicados],
              ['funil-submeteram', 'Submeteram', d.funil.submeteram],
              ['funil-reportaram', 'Reportaram', d.funil.reportaram],
            ].map(([id, rot, et]) => {
              const etapa = et as { valor: number; pct: number };
              return (
                <div key={id as string} id={id as string} className="rounded-lg bg-slate-50 p-3 text-center">
                  <div className="text-lg font-bold text-ink">{etapa.valor}</div>
                  <div className="text-[11px] text-slate-500">{rot as string} · {etapa.pct}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
