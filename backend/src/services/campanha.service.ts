import { cobreTodosOsElegiveis, elegivelParaCampanha, exigeConfirmacao, statusEfetivo, statusRecebeCampanha, type CadastroCampanha, type DestinatarioElegivel } from '../models/campanha.model.js';
import { falhar } from '../utils/resposta.js';
import { gerarTokenLink, hashToken } from '../utils/tokens.js';
import { SEM_DEPARTAMENTO } from '../models/dominio.model.js';
import { registrarAuditoria } from './auditoria.service.js';
import { enviarEmailsCampanha } from './campanhaEmail.service.js';
import { funilDe, mapCampaign, totais } from './campanhaMetricas.service.js';
import * as repo from '../repositories/campanha.repository.js';
import { idsExistentes } from '../repositories/departamento.repository.js';
import { anexosDaCampanha } from './analiseArquivo.service.js';
import { validadeReservaAnaliseMs } from '../models/analiseArquivo.model.js';
import { possivelRepasse } from '../models/treinamento.model.js';

// Campanhas de phishing SIMULADO: criacao com e-mail por destinatario, lista com metricas,
// relatorio (funil, treinamentos, reportes, por departamento) e exclusao.

/**
 * Cria a campanha para destinatarios ja validados no formato e no dominio. So recebe
 * campanha conta cadastrada e Ativa (`statusRecebeCampanha`): inexistente ou Inativo mantem a
 * mensagem de sempre (contrato N2 AT1); Pendente tem codigo proprio.
 */
export async function criar(atorId: string, entrada: CadastroCampanha) {
  const usuarios = await repo.usuariosPorEmail(entrada.emails.map((e) => e.toLowerCase()));
  const destinos: { userId: string; nome: string; email: string }[] = [];
  for (const email of entrada.emails) {
    const u = usuarios.find((x) => x.email.toLowerCase() === email.toLowerCase());
    if (!u || u.status === 'Inativo')
      falhar(422, `Destinatário não cadastrado ou inativo: ${email}`, 'DESTINATARIO_NAO_CADASTRADO');
    if (!statusRecebeCampanha(u.status))
      falhar(422, `Destinatário com convite pendente: ${email}`, 'DESTINATARIO_PENDENTE');
    destinos.push({ userId: u.id, nome: u.nome, email: u.email });
  }
  // Trava de envio em massa, depois da elegibilidade de cada um (o numero ja e o que sairia).
  if (!entrada.confirmado) {
    const totalElegiveis = (await repo.candidatosDestinatario(null)).filter(elegivelParaCampanha).length;
    if (exigeConfirmacao(destinos.length, totalElegiveis)) {
      const todos = cobreTodosOsElegiveis(destinos.length, totalElegiveis) ? ', todos os elegíveis da empresa' : '';
      falhar(
        422,
        `Envio em massa: a campanha atingiria ${destinos.length} destinatário(s)${todos}. Confirme com confirmarEnvioTotal: true`,
        'CONFIRMACAO_ENVIO_EM_MASSA',
      );
    }
  }

  // Cada destinatario recebe um token proprio para o link do e-mail; no banco fica so o hash.
  const tokens = destinos.map(() => gerarTokenLink());
  const campanha = await repo.criar(
    { nome: entrada.nome, template: entrada.template },
    destinos.map((d, i) => ({ userId: d.userId, destinatario: d.email, tokenHash: hashToken(tokens[i]) })),
  );
  await registrarAuditoria(atorId, 'CRIAR_CAMPANHA', `${campanha.id} (${campanha.nome}, ${campanha.template}, ${destinos.length} destinatário(s))`);
  // E-mail simulado a cada destinatario, com o link rastreavel e o de reporte (campanhaEmail.service.ts).
  // Falha de envio nao desfaz a campanha: o evento fica sem `enviadoEm`.
  const emailsEnviados = await enviarEmailsCampanha(
    campanha,
    destinos.map((d, i) => ({ userId: d.userId, nome: d.nome, email: d.email, token: tokens[i] })),
  );
  await registrarAuditoria(atorId, 'ENVIAR_CAMPANHA', `${campanha.id}: ${emailsEnviados} de ${destinos.length} e-mail(s) enviado(s)`);

  return {
    idCampanha: campanha.id,
    nome: campanha.nome,
    destinatario: destinos[0].email,
    destinatarios: destinos.map((d) => d.email),
    template: campanha.template,
    status: campanha.status,
    // Extensao compativel: quantos e-mails simulados sairam (0 em producao sem SMTP).
    emailsEnviados,
  };
}

/**
 * Destinatarios elegiveis dos departamentos dados (ou de todos, com `null`), para o formulario
 * de campanha preencher a lista; o envio continua por `destinatarios[]` em POST /campaigns, que
 * confere tudo de novo. Elegivel = a regra da criacao (`elegivelParaCampanha`). O resumo conta
 * quem ficou de fora e por que, para a tela nao esconder a exclusao.
 */
export async function destinatariosElegiveis(departamentos: string[] | null) {
  if (departamentos) {
    const existentes = new Set(await idsExistentes(departamentos));
    if (departamentos.some((id) => !existentes.has(id)))
      falhar(404, 'Departamento não encontrado', 'DEPARTAMENTO_NAO_ENCONTRADO');
  }
  const candidatos = await repo.candidatosDestinatario(departamentos);
  const lista: DestinatarioElegivel[] = candidatos
    .filter(elegivelParaCampanha)
    .map((u) => ({ id: u.id, nome: u.nome, email: u.email, departamento: u.department?.name ?? null }));
  // Cada excluido conta uma vez, pelo primeiro motivo: status (inativo, pendente) e depois dominio.
  const inativos = candidatos.filter((u) => u.status === 'Inativo').length;
  const pendentes = candidatos.filter((u) => u.status !== 'Inativo' && !statusRecebeCampanha(u.status)).length;
  return {
    lista,
    resumo: { total: lista.length, inativos, pendentes, foraDoDominio: candidatos.length - lista.length - inativos - pendentes },
  };
}

export async function listar() {
  const campanhas = await repo.listarComEventos();
  const { enviados, clicados } = totais(campanhas);
  return {
    lista: campanhas.map(mapCampaign),
    resumo: {
      ativas: campanhas.filter((c) => statusEfetivo(c.status, c.eventos) === 'ATIVA').length,
      taxaMediaClique: enviados ? Math.round((clicados / enviados) * 100) : 0,
      colaboradoresAlcancados: campanhas.reduce((a, c) => a + c.eventos.length, 0),
      resilienciaMedia: enviados ? Math.round((1 - clicados / enviados) * 100) : 0,
    },
  };
}

/** Relatorio da campanha: funil, treinamentos de quem clicou, reportes e por departamento. */
export async function relatorio(id: string) {
  const c = await repo.relatorio(id);
  if (!c) falhar(404, 'Campanha não encontrada', 'CAMPANHA_NAO_ENCONTRADA');
  const depDe = (e: (typeof c.eventos)[number]) => e.user.department?.name ?? SEM_DEPARTAMENTO;
  // Agrupa pelo departamento ATUAL de cada pessoa (limitacao documentada: nao ha copia historica).
  const grupos = new Map<string, { destinatarios: number; enviados: number; clicados: number }>();
  for (const e of c.eventos) {
    const g = grupos.get(depDe(e)) ?? { destinatarios: 0, enviados: 0, clicados: 0 };
    g.destinatarios += 1;
    if (e.enviadoEm) g.enviados += 1;
    if (e.clicadoEm) g.clicados += 1;
    grupos.set(depDe(e), g);
  }
  return {
    id: c.id, nome: c.nome, template: c.template, status: statusEfetivo(c.status, c.eventos), criadoEm: c.criadoEm,
    destinatarios: c.eventos.length,
    funil: funilDe(c.eventos),
    // Resumo das aberturas do link do e-mail (Melhorias #6): o total conta toda abertura, nao pessoas.
    resumo: {
      aberturas: c.eventos.reduce((a, e) => a + e._count.aberturas, 0),
      possiveisRepasses: c.eventos.filter((e) => possivelRepasse(e._count.aberturas)).length,
    },
    // Quem clicou (abriu o link). `aberturas` conta cada abertura; mais de uma = possivel repasse.
    treinamentos: c.eventos.filter((e) => e.clicadoEm).map((e) => ({
      token: e.id, destinatario: e.destinatario, departamento: depDe(e), concluido: e.treinou, concluidoEm: e.treinouEm, reportouEm: e.reportouEm,
      aberturas: e._count.aberturas, possivelRepasse: possivelRepasse(e._count.aberturas),
    })),
    // Quem reportou o e-mail simulado (pelo rodape do e-mail), clicando ou nao.
    reportes: c.eventos
      .filter((e) => e.reportouEm)
      .sort((a, b) => a.reportouEm!.getTime() - b.reportouEm!.getTime())
      .map((e) => ({ destinatario: e.destinatario, departamento: depDe(e), reportouEm: e.reportouEm, clicou: !!e.clicadoEm })),
    porDepartamento: [...grupos.entries()]
      .map(([departamento, g]) => ({
        departamento,
        destinatarios: g.destinatarios,
        clicados: g.clicados,
        taxaClique: g.enviados ? Math.round((g.clicados / g.enviados) * 100) : 0,
      }))
      .sort((a, b) => b.destinatarios - a.destinatarios || a.departamento.localeCompare(b.departamento, 'pt-BR')),
    // Anexos suspeitos que os destinatarios enviaram para analise, com os vereditos (B23).
    anexos: await anexosDaCampanha(c.id),
  };
}

/** Fora do contrato da N2 AT1; existe para remover simulacoes de teste sem mexer no banco. */
export async function excluir(atorId: string, id: string): Promise<void> {
  const campanha = await repo.buscar(id);
  if (!campanha) falhar(404, 'Campanha não encontrada', 'CAMPANHA_NAO_ENCONTRADA');
  // Anexo suspeito analisado ou em analise (B23) guarda a campanha de origem: excluir a campanha apagaria os
  // eventos e a analise perderia a origem em silencio (FK SET NULL). Mesmo espirito do
  // USUARIO_COM_HISTORICO: a campanha com evidencia fica.
  // Reserva com heartbeat em dia = analise em curso (o envio pode durar ate o teto de 30 min).
  if ((await repo.contarAnalisesDaCampanha(campanha.id, validadeReservaAnaliseMs())) > 0)
    falhar(409, 'Campanha com anexos analisados não pode ser excluída', 'CAMPANHA_COM_ANALISES');
  await repo.excluir(campanha.id);
  await registrarAuditoria(atorId, 'EXCLUIR_CAMPANHA', `${campanha.id} (${campanha.nome})`);
}
