import type { CadastroCampanha } from '../models/campanha.model.js';
import { falhar } from '../utils/resposta.js';
import { gerarTokenLink, hashToken } from '../utils/tokens.js';
import { SEM_DEPARTAMENTO } from '../models/dominio.model.js';
import { registrarAuditoria } from './auditoria.service.js';
import { enviarEmailsCampanha } from './campanhaEmail.service.js';
import { funilDe, mapCampaign, totais } from './campanhaMetricas.service.js';
import * as repo from '../repositories/campanha.repository.js';

// Campanhas de phishing SIMULADO: criacao com e-mail por destinatario, lista com metricas,
// relatorio (funil, treinamentos, reportes, por departamento) e exclusao.

/**
 * Cria a campanha para destinatarios ja validados no formato e no dominio. So recebe
 * campanha quem esta cadastrado e nao esta Inativo.
 */
export async function criar(atorId: string, entrada: CadastroCampanha) {
  const usuarios = await repo.usuariosPorEmail(entrada.emails.map((e) => e.toLowerCase()));
  const destinos: { userId: string; nome: string; email: string }[] = [];
  for (const email of entrada.emails) {
    const u = usuarios.find((x) => x.email.toLowerCase() === email.toLowerCase());
    if (!u || u.status === 'Inativo')
      falhar(422, `Destinatário não cadastrado ou inativo: ${email}`, 'DESTINATARIO_NAO_CADASTRADO');
    destinos.push({ userId: u.id, nome: u.nome, email: u.email });
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

export async function listar() {
  const campanhas = await repo.listarComEventos();
  const { enviados, clicados } = totais(campanhas);
  return {
    lista: campanhas.map(mapCampaign),
    resumo: {
      ativas: campanhas.filter((c) => c.status === 'ATIVA').length,
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
    id: c.id, nome: c.nome, template: c.template, status: c.status, criadoEm: c.criadoEm,
    destinatarios: c.eventos.length,
    funil: funilDe(c.eventos),
    treinamentos: c.eventos.filter((e) => e.clicadoEm).map((e) => ({ token: e.id, destinatario: e.destinatario, departamento: depDe(e), concluido: e.treinou, concluidoEm: e.treinouEm, reportouEm: e.reportouEm })),
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
  };
}

/** Fora do contrato da N2 AT1; existe para remover simulacoes de teste sem mexer no banco. */
export async function excluir(atorId: string, id: string): Promise<void> {
  const campanha = await repo.buscar(id);
  if (!campanha) falhar(404, 'Campanha não encontrada', 'CAMPANHA_NAO_ENCONTRADA');
  await repo.excluir(campanha.id);
  await registrarAuditoria(atorId, 'EXCLUIR_CAMPANHA', `${campanha.id} (${campanha.nome})`);
}
