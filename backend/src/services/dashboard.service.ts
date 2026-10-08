import { OPERADORES } from '../models/dominio.model.js';
import { avancarVarreduras } from './cicloVarredura.service.js';
import { contar as contarAtivos } from '../repositories/ativo.repository.js';
import { listarComEventos } from '../repositories/campanha.repository.js';
import { contarArquivosMaliciosos } from './analiseArquivo.service.js';
import { funilDe, mapCampaign, totais } from './campanhaMetricas.service.js';
import { ativosMaiorRisco } from './riscoAtivo.service.js';
import { encerrado, mapFinding, todos as todosAchados } from './vulnerabilidade.service.js';

// Dashboard unificado: risco tecnico (achados) + risco humano (campanhas) num painel so.
// Nao tem repository proprio: agrega os de ativos e campanhas e os services de achados e de
// analise de arquivos.
//
// Arquivos maliciosos no risco tecnico (B17): `arquivosMaliciosos` = arquivos distintos por
// SHA-256 com AMEACA do ClamAV nos ultimos 30 dias (services/analiseArquivo.service.ts). Cada um
// pesa como um achado CRITICO: entra em `criticas` e em `distribuicaoSeveridade['Crítico']`,
// mas NAO em `vulnerabilidadesAbertas` (arquivo malicioso nao e vulnerabilidade de ativo).
// Logo: soma da distribuicao = vulnerabilidadesAbertas + arquivosMaliciosos. O risco tecnico
// do frontend, que pondera a distribuicao, ja recebe o peso critico sem mudar a formula.

/**
 * Colaborador recebe so o indice de resiliencia a phishing (RN-006): os KPIs tecnicos
 * (vulnerabilidades, criticas, ativos) e a distribuicao por severidade vem `null`, e as
 * listas e metricas por campanha ficam com os operadores. Sem envio, a resiliencia e
 * `null` (nao medida), nunca 0.
 *
 * `ativosMaiorRisco` (B25): os 5 ativos de maior nota de risco (services/riscoAtivo.service.ts),
 * calculada nesta leitura. Nome e host de ativo vulneravel sao dado tecnico: para o Colaborador
 * a lista vem vazia, como as outras listas tecnicas.
 */
export async function painel(perfil: string) {
  const operador = OPERADORES.includes(perfil);
  const campanhas = await listarComEventos();
  const { enviados, clicados } = totais(campanhas);
  const resiliencia = enviados ? Math.round((1 - clicados / enviados) * 100) : null;

  if (!operador) {
    // Mesmo sem a parte tecnica, a leitura do dashboard conclui as varreduras pendentes
    // (B21/B26: o ciclo anda na leitura, para qualquer perfil).
    await avancarVarreduras();
    return {
      kpis: {
        vulnerabilidadesAbertas: null,
        criticas: null,
        arquivosMaliciosos: null, // KPI tecnico (B17): fica com os operadores, como os demais
        resilienciaPhishing: resiliencia,
        ativosMonitorados: null,
      },
      distribuicaoSeveridade: null,
      vulnerabilidadesRecentes: [],
      ativosMaiorRisco: [],
      alertas: [],
      campanhas: [],
      funil: null,
      campanhaAtiva: null,
    };
  }

  const findings = await todosAchados();
  // "Resolvida" e "Risco aceito" saem dos KPIs, dos alertas e da lista de recentes.
  const emAberto = findings.filter((f) => !encerrado(f));
  const sev: Record<string, number> = { 'Crítico': 0, 'Alto': 0, 'Médio': 0, 'Baixo': 0 };
  for (const f of emAberto) sev[f.severidade] = (sev[f.severidade] || 0) + 1;
  const arquivosMaliciosos = await contarArquivosMaliciosos();
  sev['Crítico'] += arquivosMaliciosos;

  const ativos = await contarAtivos();
  const ativa = campanhas.find((c) => c.status === 'ATIVA') || campanhas[0];

  return {
    kpis: {
      vulnerabilidadesAbertas: emAberto.length,
      criticas: emAberto.filter((f) => f.cvss >= 9.0).length + arquivosMaliciosos,
      // KPI tecnico: so para operadores, como os outros (o Colaborador recebe null, B10).
      arquivosMaliciosos,
      resilienciaPhishing: resiliencia,
      ativosMonitorados: ativos,
    },
    distribuicaoSeveridade: sev,
    vulnerabilidadesRecentes: emAberto.slice(0, 5).map(mapFinding),
    ativosMaiorRisco: await ativosMaiorRisco(),
    alertas: emAberto
      .slice(0, 3)
      .map((f) => ({ id: f.id, severidade: f.severidade, texto: `${f.categoriaOwasp} em ${f.scan.asset.host}`, cvss: f.cvss, quando: f.criadoEm })),
    campanhas: campanhas.map(mapCampaign),
    funil: ativa ? funilDe(ativa.eventos) : null,
    campanhaAtiva: ativa ? ativa.nome : null,
  };
}
