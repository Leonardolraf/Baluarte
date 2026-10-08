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
