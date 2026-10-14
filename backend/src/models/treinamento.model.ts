import { OPERADORES } from './dominio.model.js';

// Model do treinamento pos-clique: o conteudo por template de campanha (dado estatico do
// dominio), quem pode ver cada treinamento e o DTO entregue a tela.

/** Quem le o treinamento (dentro do sistema). */
export type Leitor = { id: string; perfil: string };

// Conteudo do treinamento pos-clique por template de campanha.
const CONTEUDO_TREINAMENTO: Record<string, { tipoAtaque: string; titulo: string; codigoModulo: string; duracaoMin: number; sinaisAlerta: string[]; boasPraticas: string[] }> = {
  urgencia: {
    tipoAtaque: 'Phishing por Urgência',
    titulo: 'Como reconhecer urgência artificial',
    codigoModulo: 'US-005',
    duracaoMin: 8,
    sinaisAlerta: ['Pressão por ação imediata', 'Remetente desconhecido ou disfarçado', 'Links que não batem com o domínio oficial'],
    boasPraticas: ['Confira o remetente real', 'Passe o mouse sobre os links antes de clicar', 'Na dúvida, reporte ao time de TI'],
  },
  autoridade: {
    tipoAtaque: 'Phishing por Autoridade',
    titulo: 'Quando o "chefe" pede algo fora do processo',
    codigoModulo: 'US-006',
    duracaoMin: 7,
    sinaisAlerta: ['Pedido sigiloso vindo de uma chefia', 'Fuga dos canais e aprovações habituais', 'Tom que desencoraja perguntas'],
    boasPraticas: ['Confirme o pedido por outro canal (telefone, chat corporativo)', 'Siga o processo de aprovação mesmo sob pressão', 'Reporte tentativas ao time de segurança'],
  },
  curiosidade: {
    tipoAtaque: 'Phishing por Curiosidade',
    titulo: 'Anexos e links que despertam curiosidade',
    codigoModulo: 'US-007',
    duracaoMin: 6,
    sinaisAlerta: ['Assunto vago ou intrigante ("veja isso", "documento pendente")', 'Anexo inesperado, sem contexto', 'Link encurtado ou domínio parecido com o oficial'],
    boasPraticas: ['Não abra anexos que você não estava esperando', 'Verifique o domínio completo antes de clicar', 'Pergunte ao remetente por um canal confiável'],
  },
};

/** Colaborador so acessa o proprio treinamento; Administrador e Analista acessam todos. */
export function podeVerTreinamento(usuario: { id: string; perfil: string }, evento: { userId: string }): boolean {
  return evento.userId === usuario.id || OPERADORES.includes(usuario.perfil);
}

/** Conteudo do treinamento (pelo template da campanha) e o progresso do destinatario. */
export function dadosTreinamento(evento: { treinou: boolean; treinouEm: Date | null; campaign: { template: string } }) {
  const conteudo = CONTEUDO_TREINAMENTO[evento.campaign.template] ?? CONTEUDO_TREINAMENTO.urgencia;
  return {
    ...conteudo,
    template: evento.campaign.template,
    progresso: evento.treinou ? 100 : 0,
    concluidoEm: evento.treinouEm,
  };
}

// ---- Aberturas do link do e-mail (Melhorias #6) ---------------------------------
// Cada abertura do link vira uma linha em CampaignLinkHit, deduplicada por JANELA_ABERTURA_MS e
// limitada a TETO_ABERTURAS_POR_EVENTO (o clique do funil continua um por pessoa). IP e user-agent sao dado pessoal: guardados so para a equipe investigar repasse e
// anulados depois de RETENCAO_DADOS_ABERTURA_DIAS. Nunca saem pela API.

/** LGPD: dias que o IP e o user-agent de uma abertura ficam guardados (decisao de 14/10/2026). */
export const RETENCAO_DADOS_ABERTURA_DIAS = 90;
/**
 * No maximo uma abertura contada por evento a cada 30 min. O link e publico: sem janela, F5,
 * reabrir a aba e o prefetch de clientes de e-mail (o Gmail busca o link ao exibir a mensagem)
 * viram "aberturas" e inflam o possivel repasse. 30 min separa esse ruido da mesma pessoa de
 * uma segunda abertura de verdade (outro aparelho, e-mail repassado).
 */
export const JANELA_ABERTURA_MS = 30 * 60 * 1000;
/**
 * Teto de linhas por evento. O endpoint e publico: sem teto, um loop no link (mesmo com a
 * janela, ao longo de dias) enche a tabela e o disco. Acima de 50 a contagem para em 50; o
 * rotulo de possivel repasse ja aparece com 2.
 */
export const TETO_ABERTURAS_POR_EVENTO = 50;
/** Limites das CHECKs da tabela CampaignLinkHit (migration 20261014120100). */
export const IP_ABERTURA_MAX = 45;
export const USER_AGENT_ABERTURA_MAX = 512;

/** Origem da requisicao que abriu o link (os dois opcionais). */
export type OrigemAbertura = { ip?: string | null; userAgent?: string | null };

/** Corta no limite da CHECK; vazio (ou so espaco/controle) vira null, que a CHECK aceita. */
function limitar(valor: string | null | undefined, max: number): string | null {
  // eslint-disable-next-line no-control-regex
  const limpo = (valor ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return limpo ? limpo.slice(0, max) : null;
}

/** IP e user-agent prontos para gravar, dentro das CHECKs da tabela. */
export function dadosDaAbertura(origem: OrigemAbertura = {}) {
  return { ip: limitar(origem.ip, IP_ABERTURA_MAX), userAgent: limitar(origem.userAgent, USER_AGENT_ABERTURA_MAX) };
}

/** Mais de uma abertura do mesmo link sugere que o e-mail foi repassado (ou aberto em outro aparelho). */
export function possivelRepasse(aberturas: number): boolean {
  return aberturas > 1;
}
