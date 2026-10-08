import { falhar } from '../../http/resposta.js';
import { SEM_DEPARTAMENTO } from '../../shared/dominio.js';
import { registrarAuditoria } from '../audit/service.js';
import { dadosTreinamento, podeVerTreinamento } from './conteudo.js';
import * as repo from './repository.js';

// Treinamento pos-clique. Dois acessos: dentro do sistema (id do evento, com login) e pelo
// link do e-mail simulado (token aleatorio guardado so como hash, sem login).

/**
 * Tudo o que a tela de treinamentos precisa numa requisicao so. Conclusao = clicou e
 * concluiu o treinamento, a mesma regra do relatorio da campanha (bate com o dashboard).
 */
export async function consolidado() {
  const [campanhas, cliques, concluidos] = await repo.consolidado();
  const pessoas = new Map<string, { nome: string; email: string; departamento: string; campanhas: { id: string; nome: string }[] }>();
  const porDep = new Map<string, number>();
  for (const e of concluidos) {
    const departamento = e.user.department?.name ?? SEM_DEPARTAMENTO;
    const p = pessoas.get(e.user.id) ?? { nome: e.user.nome, email: e.user.email, departamento, campanhas: [] };
    p.campanhas.push({ id: e.campaign.id, nome: e.campaign.nome });
    pessoas.set(e.user.id, p);
    porDep.set(departamento, (porDep.get(departamento) ?? 0) + 1);
  }
  const conclusoes = concluidos.length;
  return {
    campanhas,
    conclusoes,
    cliques,
    pendentesAposClique: Math.max(0, cliques - conclusoes),
    // Todo evento tem usuario (userId obrigatorio): no backend real toda conclusao e nominal.
    conclusoesNominais: conclusoes,
    colaboradores: [...pessoas.values()].sort(
      (a, b) => b.campanhas.length - a.campanhas.length || a.nome.localeCompare(b.nome, 'pt-BR'),
    ),
    porDepartamento: [...porDep.entries()]
      .map(([departamento, n]) => ({ departamento, conclusoes: n }))
      .sort((a, b) => b.conclusoes - a.conclusoes || a.departamento.localeCompare(b.departamento, 'pt-BR')),
  };
}

type Leitor = { id: string; perfil: string };

async function eventoVisivel(leitor: Leitor, id: string) {
  const evento = await repo.eventoPorId(id);
  if (!evento) falhar(404, 'Treinamento não encontrado', 'TREINAMENTO_NAO_ENCONTRADO');
  if (!podeVerTreinamento(leitor, evento))
    falhar(403, 'Este treinamento pertence a outro colaborador', 'TREINAMENTO_DE_OUTRO_USUARIO');
  return evento;
}

/** Treinamento dentro do sistema (`id` = id do evento de campanha). */
export async function ver(leitor: Leitor, id: string) {
  const evento = await eventoVisivel(leitor, id);
  return { ...dadosTreinamento(evento), campanha: evento.campaign.nome, idCampanha: evento.campaign.id };
}

/** Conclusao dentro do sistema (idempotente). */
export async function concluir(leitor: Leitor, id: string) {
  const evento = await eventoVisivel(leitor, id);
  const atualizado = evento.treinou ? evento : await repo.marcarConcluido(evento.id);
  if (!evento.treinou)
    await registrarAuditoria(leitor.id, 'CONCLUIR_TREINAMENTO', `${evento.campaign.nome} / ${evento.destinatario}`);
  return { token: evento.id, concluido: true, concluidoEm: atualizado.treinouEm };
}

/**
 * Abertura pelo link do e-mail: registra a abertura e o clique (uma vez) e entrega o
 * treinamento contextual, sem expor ids nem o nome da campanha.
 */
export async function abrirPeloLink(token: string) {
  const evento = await repo.eventoPeloLink(token);
  if (!evento) falhar(404, 'Treinamento não encontrado', 'TREINAMENTO_NAO_ENCONTRADO');
  if (!evento.clicadoEm) {
    const agora = new Date();
    await repo.marcarClique(evento.id, agora, evento.abertoEm ?? agora);
    await registrarAuditoria(evento.userId, 'CLIQUE_LINK_PHISHING', `${evento.campaign.nome} / ${evento.destinatario}`);
  }
  return dadosTreinamento(evento);
}

/** Conclusao pelo link do e-mail; o clique (abertura do link) e pre-requisito. */
export async function concluirPeloLink(token: string) {
  const evento = await repo.eventoPeloLink(token);
  if (!evento) falhar(404, 'Treinamento não encontrado', 'TREINAMENTO_NAO_ENCONTRADO');
  if (!evento.clicadoEm) falhar(409, 'Abra o treinamento antes de concluí-lo', 'TREINAMENTO_NAO_INICIADO');
  const atualizado = evento.treinou ? evento : await repo.marcarConcluido(evento.id);
  if (!evento.treinou)
    await registrarAuditoria(evento.userId, 'CONCLUIR_TREINAMENTO', `${evento.campaign.nome} / ${evento.destinatario}`);
  return { concluido: true, concluidoEm: atualizado.treinouEm };
}

/**
 * Reporte do e-mail suspeito pelo mesmo token. Idempotente: o primeiro reporte vale; os
 * seguintes devolvem a mesma data. Registra a abertura junto; nao registra clique.
 */
export async function reportar(token: string) {
  const evento = await repo.eventoPeloLink(token);
  if (!evento) falhar(404, 'Link de campanha não encontrado', 'LINK_NAO_ENCONTRADO');
  let reportouEm = evento.reportouEm;
  if (!reportouEm) {
    const agora = new Date();
    if (await repo.marcarReporte(evento.id, agora, evento.abertoEm ?? agora)) {
      reportouEm = agora;
      await registrarAuditoria(evento.userId, 'REPORTAR_PHISHING', `${evento.campaign.nome} / ${evento.destinatario}`);
    } else {
      reportouEm = await repo.dataDoReporte(evento.id);
    }
  }
  return { reportado: true, reportadoEm: reportouEm };
}
