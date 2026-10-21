import type { Training, TrainingId } from '../types';

/**
 * Treinamentos contextuais — textos copiados, sem resumir, de
 * `baluarte-frontend/src/mocks/data.ts` (MOCK_TRAININGS).
 */
export const TRAININGS: Record<TrainingId, Training> = {
  'trn-urgency': {
    id: 'trn-urgency',
    moduleCode: 'US-005',
    title: 'Reconhecendo golpes de urgência',
    attackType: 'Phishing por urgência',
    summary:
      'Golpes de urgência pressionam você a agir sem pensar, alegando bloqueios, prazos e consequências imediatas. Este módulo mostra como reconhecer o gatilho e reagir com calma.',
    sections: [
      {
        heading: 'Como a urgência é usada contra você',
        body: 'Mensagens de urgência criam medo de perder algo ou de sofrer uma punição: "sua conta será bloqueada em 24 horas" ou "pagamento pendente será cancelado". O objetivo é fazer você clicar antes de raciocinar.',
      },
      {
        heading: 'Pare e respire antes de clicar',
        body: 'Nenhuma solicitação legítima exige que você aja em segundos. Ao sentir pressão para agir imediatamente, trate isso como um sinal de alerta e verifique o remetente por um canal oficial.',
      },
      {
        heading: 'Confirme pelo canal oficial',
        body: 'Em vez de clicar no link da mensagem, acesse o sistema digitando você mesmo o endereço, ou ligue para o setor responsável usando um contato que você já conhece.',
      },
    ],
    warningSigns: [
      'Prazos curtíssimos e ameaças de bloqueio ou multa.',
      'Pedido para clicar em um link "agora" para evitar consequências.',
      'Erros de português e endereços de remetente estranhos.',
      'Solicitação de senha ou dados sensíveis por e-mail.',
    ],
    bestPractices: [
      'Desconfie de qualquer mensagem que exija ação imediata.',
      'Digite o endereço do sistema no navegador em vez de clicar no link.',
      'Confirme com o setor responsável por um canal já conhecido.',
      'Reporte a mensagem suspeita ao time de TI.',
    ],
  },
  'trn-authority': {
    id: 'trn-authority',
    moduleCode: 'US-006',
    title: 'Golpes que usam autoridade',
    attackType: 'Phishing por autoridade',
    summary:
      'Atacantes se passam por diretores, gerentes ou pela equipe de TI para conseguir que você siga ordens sem questionar. Aprenda a validar solicitações que invocam hierarquia.',
    sections: [
      {
        heading: 'A força do "chefe pediu"',
        body: 'Quando uma mensagem parece vir de um superior ou da TI, tendemos a obedecer sem checar. Golpistas exploram exatamente essa deferência à autoridade para pedir transferências, senhas ou instalação de programas.',
      },
      {
        heading: 'Sinais de falsa autoridade',
        body: 'Desconfie de pedidos incomuns feitos com pressa, sigilo ("não comente com ninguém") e por um canal diferente do habitual. E-mails que imitam o nome do diretor mas usam um endereço externo são clássicos.',
      },
      {
        heading: 'Valide fora do canal da mensagem',
        body: 'Confirme a solicitação pessoalmente, por telefone ou pelo aplicativo corporativo oficial. Uma verificação de trinta segundos evita um incidente grave.',
      },
    ],
    warningSigns: [
      'Pedido urgente e sigiloso vindo de um "diretor" ou da "TI".',
      'Endereço de e-mail que imita, mas não é, o oficial.',
      'Solicitação de transferência, senha ou acesso fora do processo normal.',
      'Tom que desencoraja você a confirmar com outras pessoas.',
    ],
    bestPractices: [
      'Confirme pedidos sensíveis por um segundo canal oficial.',
      'Verifique cuidadosamente o endereço real do remetente.',
      'Nunca compartilhe senhas, nem mesmo com a TI.',
      'Reporte solicitações estranhas, mesmo que pareçam vir da chefia.',
    ],
  },
  'trn-curiosity': {
    id: 'trn-curiosity',
    moduleCode: 'US-007',
    title: 'Curiosidade e iscas de conteúdo',
    attackType: 'Phishing por curiosidade',
    summary:
      'Iscas de curiosidade prometem informações irresistíveis — plano de cargos, fotos do evento, uma fatura inesperada — para induzir o clique. Este módulo ensina a resistir à tentação.',
    sections: [
      {
        heading: 'A isca da curiosidade',
        body: 'Assuntos como "novo plano de cargos e salários" ou "sua fatura em anexo" despertam interesse imediato. O anexo ou link, porém, esconde malware ou uma página falsa de captura de credenciais.',
      },
      {
        heading: 'Anexos e links inesperados',
        body: 'Documentos que você não estava esperando, especialmente com extensões como .zip, .html ou macros, merecem desconfiança. Passe o mouse sobre o link para ver o destino real antes de qualquer ação.',
      },
      {
        heading: 'Verifique a origem antes de abrir',
        body: 'Confirme com o suposto remetente se ele realmente enviou aquele conteúdo. Na dúvida, não abra e reporte à TI.',
      },
    ],
    warningSigns: [
      'Assunto sensacionalista ou "exclusivo" que desperta curiosidade.',
      'Anexo ou link que você não solicitou.',
      'Endereço de link diferente do texto exibido.',
      'Promessa de conteúdo interno vindo de fora da empresa.',
    ],
    bestPractices: [
      'Passe o mouse sobre os links para ver o destino real.',
      'Não abra anexos inesperados; confirme com o remetente.',
      'Trate ofertas boas demais para ser verdade como golpe.',
      'Reporte a mensagem suspeita antes de interagir.',
    ],
  },
};

/** Módulo pelo id; `undefined` para id desconhecido (ex.: URL digitada à mão na web). */
export function findTraining(id: string): Training | undefined {
  return Object.prototype.hasOwnProperty.call(TRAININGS, id) ? TRAININGS[id as TrainingId] : undefined;
}
