import { OPERADORES } from '../models/dominio.model.js';
import { contar as contarAtivos } from '../repositories/ativo.repository.js';
import { listarComEventos } from '../repositories/campanha.repository.js';
import { funilDe, mapCampaign, totais } from './campanhaMetricas.service.js';
import { encerrado, mapFinding, todos as todosAchados } from './vulnerabilidade.service.js';

// Dashboard unificado: risco tecnico (achados) + risco humano (campanhas) num painel so.
// Nao tem repository proprio: agrega os de ativos e campanhas e o service de achados.

/** Colaborador recebe so indices e KPIs; listas e metricas por campanha ficam com operadores (RN-006). */
export async function painel(perfil: string) {
  const operador = OPERADORES.includes(perfil);
  const findings = await todosAchados();
  // "Resolvida" e "Risco aceito" saem dos KPIs, dos alertas e da lista de recentes.
  const emAberto = findings.filter((f) => !encerrado(f));
  const sev: Record<string, number> = { 'Crítico': 0, 'Alto': 0, 'Médio': 0, 'Baixo': 0 };
  for (const f of emAberto) sev[f.severidade] = (sev[f.severidade] || 0) + 1;

  const ativos = await contarAtivos();
  const campanhas = await listarComEventos();
  const { enviados, clicados } = totais(campanhas);
  const resiliencia = enviados ? Math.round((1 - clicados / enviados) * 100) : 0;
  const ativa = campanhas.find((c) => c.status === 'ATIVA') || campanhas[0];

  return {
    kpis: {
      vulnerabilidadesAbertas: emAberto.length,
      criticas: emAberto.filter((f) => f.cvss >= 9.0).length,
      resilienciaPhishing: resiliencia,
      ativosMonitorados: ativos,
    },
    distribuicaoSeveridade: sev,
    vulnerabilidadesRecentes: operador ? emAberto.slice(0, 5).map(mapFinding) : [],
    alertas: operador
      ? emAberto.slice(0, 3).map((f) => ({ id: f.id, severidade: f.severidade, texto: `${f.categoriaOwasp} em ${f.scan.asset.host}`, cvss: f.cvss, quando: f.criadoEm }))
      : [],
    // Metricas por campanha (nomes, taxa de clique, funil) sao dado de acesso restrito
    // (RN-006): so Administrador/Analista. Colaborador ve apenas os indices agregados.
    campanhas: operador ? campanhas.map(mapCampaign) : [],
    funil: operador && ativa ? funilDe(ativa.eventos) : null,
    campanhaAtiva: operador && ativa ? ativa.nome : null,
  };
}
