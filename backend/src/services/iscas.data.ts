// Iscas (assunto + corpo) de cada template da campanha de phishing SIMULADO, separadas do
// serviço (campanhaEmail.service.ts) para o conteúdo entrar como dado, não como código.
// Conteúdo das 36 iscas (12 por template) aprovado pelo Leo em 20/10/2026.
//
// INVARIANTES (as mesmas do serviço; valem para TODA isca de TODO template, e o
// tests/unidade/iscas.test.ts confere):
//  - só texto: nenhuma marca de HTML, nenhum anexo, nenhum formulário;
//  - NENHUM pedido de senha, PIN, código ou dado pessoal no corpo;
//  - o único link do corpo é o `${link}` do treinamento, que aponta para o próprio
//    frontend da plataforma; a isca NUNCA escreve outra URL;
//  - a isca NÃO inclui o rodapé de simulação nem o link de reporte: isso é anexado por
//    `mensagemCampanha`, para todas as iscas de uma vez.
//
// Uma isca por posição; o serviço sorteia uma por destinatário de forma determinística
// (ver `selecionarIsca`). O array fica aberto para crescer. A isca [0] de cada template é a
// que o cadastro da campanha descreve como exemplo do template.

export interface Isca {
  assunto: string;
  corpo: (nome: string, link: string) => string;
}

export const ISCAS: Record<string, Isca[]> = {
  urgencia: [
    {
      assunto: 'Ação necessária: sua conta será bloqueada em 24 horas',
      corpo: (nome, link) =>
        `Olá, ${nome}.\n\n` +
        'Identificamos uma pendência no cadastro da sua conta corporativa. Se ela não for ' +
        'regularizada nas próximas 24 horas, o seu acesso será bloqueado.\n\n' +
        `Regularize agora: ${link}\n\n` +
        'Equipe de Suporte',
    },
    {
      assunto: 'Sua senha expira hoje — renove para não perder o acesso',
      corpo: (nome, link) =>
        `Olá, ${nome}.\n\n` +
        'Nossa política de segurança exige a troca da senha a cada 90 dias, e a sua expira ainda ' +
        'hoje. Se não for renovada, você perderá o acesso ao e-mail e aos sistemas amanhã de manhã.\n\n' +
        `Renove em instantes: ${link}\n\n` +
        'Equipe de TI',
    },
    {
      assunto: 'Caixa de entrada quase cheia — mensagens podem ser recusadas',
      corpo: (nome, link) =>
        `Olá, ${nome}.\n\n` +
        'Sua caixa de e-mail atingiu 98% da capacidade. Ao chegar a 100%, novas mensagens serão ' +
        'recusadas e você pode deixar de receber comunicados importantes.\n\n' +
        `Libere espaço agora: ${link}\n\n` +
        'Administração de E-mail',
    },
    {
      assunto: 'Detectamos um acesso incomum à sua conta',
      corpo: (nome, link) =>
        `Olá, ${nome}.\n\n` +
        'Registramos uma tentativa de login na sua conta a partir de um dispositivo desconhecido. ' +
        'Se não foi você, é preciso confirmar seus dados imediatamente para proteger o acesso.\n\n' +
        `Confirme que foi você: ${link}\n\n` +
        'Central de Segurança',
    },
    {
      assunto: 'Atualização de segurança obrigatória até o fim do dia',
      corpo: (nome, link) =>
        `Olá, ${nome}.\n\n` +
        'Uma atualização de segurança precisa ser aplicada à sua conta até o fim do expediente de ' +
        'hoje. Contas não atualizadas serão temporariamente suspensas por precaução.\n\n' +
        `Aplique a atualização: ${link}\n\n` +
        'Segurança da Informação',
    },
    {
      assunto: 'Confirmação pendente — seu benefício pode ser suspenso',
      corpo: (nome, link) =>
        `Olá, ${nome}.\n\n` +
        'Há uma pendência na confirmação cadastral do seu benefício. Sem a confirmação nas próximas ' +
        'horas, o pagamento deste mês poderá ser suspenso.\n\n' +
        `Confirme seu cadastro: ${link}\n\n` +
        'Departamento de Benefícios',
    },
    {
      assunto: 'Documento fiscal pendente — regularize antes do vencimento',
      corpo: (nome, link) =>
        `${nome},\n\n` +
        'Consta um documento fiscal pendente vinculado ao seu cadastro, com vencimento amanhã. ' +
        'A não regularização pode gerar bloqueio no sistema financeiro.\n\n' +
        `Acesse o documento: ${link}\n\n` +
        'Setor Fiscal',
    },
    {
      assunto: 'Seu acesso remoto (VPN) será revogado por inatividade',
      corpo: (nome, link) =>
        `Olá, ${nome}.\n\n` +
        'Seu acesso remoto consta como inativo e será revogado automaticamente em 24 horas. ' +
        'Para manter o acesso de casa, é necessário revalidar agora.\n\n' +
        `Revalide seu acesso: ${link}\n\n` +
        'Equipe de TI',
    },
    {
      assunto: 'Reembolso não processado — valide seus dados até amanhã',
      corpo: (nome, link) =>
        `Olá, ${nome}.\n\n` +
        'Seu pedido de reembolso não pôde ser processado por uma inconsistência nos dados. Se não ' +
        'for corrigido até amanhã, o pedido será cancelado e precisará ser refeito.\n\n' +
        `Valide seus dados: ${link}\n\n` +
        'Financeiro',
    },
    {
      assunto: 'Seu certificado digital expira em 48 horas',
      corpo: (nome, link) =>
        `${nome},\n\n` +
        'O certificado digital vinculado ao seu usuário expira em 48 horas. Sem a renovação, você ' +
        'ficará impedido de assinar documentos e acessar sistemas internos.\n\n' +
        `Renove o certificado: ${link}\n\n` +
        'Equipe de TI',
    },
    {
      assunto: 'Pendência no ponto pode travar o fechamento da folha',
      corpo: (nome, link) =>
        `Olá, ${nome}.\n\n` +
        'Identificamos uma pendência no seu registro de ponto que, se não resolvida hoje, pode ' +
        'travar o fechamento da folha deste mês e atrasar o seu pagamento.\n\n' +
        `Resolva a pendência: ${link}\n\n` +
        'Departamento Pessoal',
    },
    {
      assunto: 'Armazenamento excedido — arquivos serão arquivados',
      corpo: (nome, link) =>
        `Olá, ${nome}.\n\n` +
        'Sua área de arquivos em nuvem excedeu o limite. Em 24 horas, os arquivos mais antigos ' +
        'serão arquivados e podem ficar indisponíveis.\n\n' +
        `Gerencie seus arquivos: ${link}\n\n` +
        'Administração de Sistemas',
    },
  ],
  autoridade: [
    {
      assunto: 'Pedido da Diretoria: confirmação ainda hoje',
      corpo: (nome, link) =>
        `${nome},\n\n` +
        'Preciso que você confirme com urgência o documento de aprovação abaixo, antes da reunião ' +
        'do conselho. É um assunto sigiloso: trate diretamente comigo, sem envolver outras áreas.\n\n' +
        `Documento: ${link}\n\n` +
        'Diretoria Executiva',
    },
    {
      assunto: 'TI: migração do seu acesso — confirmação necessária',
      corpo: (nome, link) =>
        `Olá, ${nome}.\n\n` +
        'Estamos migrando as contas corporativas para o novo ambiente. Preciso que você confirme o ' +
        'seu acesso hoje para que sua conta não fique de fora da migração.\n\n' +
        `Confirme seu acesso: ${link}\n\n` +
        'Coordenação de TI',
    },
    {
      assunto: 'RH: pesquisa confidencial de clima — resposta individual',
      corpo: (nome, link) =>
        `${nome},\n\n` +
        'A diretoria solicitou uma pesquisa confidencial de clima, com resposta individual e ' +
        'sigilosa. Sua participação é importante e deve ser respondida apenas por você.\n\n' +
        `Responda aqui: ${link}\n\n` +
        'Recursos Humanos',
    },
    {
      assunto: 'Aprovação pendente antes do fechamento',
      corpo: (nome, link) =>
        `${nome},\n\n` +
        'Há uma nota aguardando sua aprovação e o fechamento é ainda hoje. Preciso que você valide ' +
        'o lançamento com prioridade para não atrasarmos o processo.\n\n' +
        `Valide o lançamento: ${link}\n\n` +
        'Gerência Financeira',
    },
    {
      assunto: 'Preciso de um favor rápido antes da reunião',
      corpo: (nome, link) =>
        `${nome},\n\n` +
        'Estou entrando em uma reunião e preciso que você resolva uma coisa rápida pra mim antes ' +
        'que eu saia. Dá uma olhada no link assim que ler — conto com você.\n\n' +
        `Detalhes: ${link}\n\n` +
        'Gerência',
    },
    {
      assunto: 'Jurídico: assinatura obrigatória de termo de compliance',
      corpo: (nome, link) =>
        `Olá, ${nome}.\n\n` +
        'Todos os colaboradores precisam assinar o termo de compliance atualizado. O seu consta ' +
        'como pendente e o prazo determinado pela diretoria encerra hoje.\n\n' +
        `Assine o termo: ${link}\n\n` +
        'Departamento Jurídico',
    },
    {
      assunto: 'Auditoria interna: validação dos seus registros de acesso',
      corpo: (nome, link) =>
        `${nome},\n\n` +
        'A auditoria interna está revisando os registros de acesso aos sistemas. Preciso que você ' +
        'valide os seus registros para encerrarmos a conferência do seu setor.\n\n' +
        `Valide seus registros: ${link}\n\n` +
        'Auditoria Interna',
    },
    {
      assunto: 'Novo sistema corporativo: faça seu primeiro acesso',
      corpo: (nome, link) =>
        `Olá, ${nome}.\n\n` +
        'A diretoria de TI liberou o novo sistema corporativo. Preciso que você faça o primeiro ' +
        'acesso ainda esta semana para ativarmos o seu perfil.\n\n' +
        `Faça o primeiro acesso: ${link}\n\n` +
        'Diretoria de TI',
    },
    {
      assunto: 'Comunicado restrito — não encaminhar',
      corpo: (nome, link) =>
        `${nome},\n\n` +
        'Segue um comunicado restrito às lideranças. Peço que leia com atenção e não encaminhe a ' +
        'ninguém até a divulgação oficial.\n\n' +
        `Comunicado: ${link}\n\n` +
        'Presidência',
    },
    {
      assunto: 'Confirmação de adequação à nova política de segurança',
      corpo: (nome, link) =>
        `Olá, ${nome}.\n\n` +
        'A nova política de segurança da informação entrou em vigor e exige que cada colaborador ' +
        'confirme sua adequação. O seu registro ainda está pendente.\n\n' +
        `Confirme sua adequação: ${link}\n\n` +
        'Segurança da Informação',
    },
    {
      assunto: 'Tratar diretamente comigo — sigiloso',
      corpo: (nome, link) =>
        `${nome},\n\n` +
        'Tenho uma demanda sigilosa e preciso resolvê-la fora dos canais normais, diretamente com ' +
        'você. Veja o que preciso no link e me retorne somente por aqui.\n\n' +
        `Detalhes: ${link}\n\n` +
        'Presidência',
    },
    {
      assunto: 'Controladoria: conciliação pendente no seu nome',
      corpo: (nome, link) =>
        `${nome},\n\n` +
        'Há uma conciliação pendente registrada no seu nome que está travando o fechamento ' +
        'contábil. Preciso que você regularize com prioridade hoje.\n\n' +
        `Regularize aqui: ${link}\n\n` +
        'Controladoria',
    },
  ],
  curiosidade: [
    {
      assunto: 'Novo plano de cargos e salários (prévia)',
      corpo: (nome, link) =>
        `Oi, ${nome}!\n\n` +
        'A prévia do novo plano de cargos e salários já está disponível para consulta. Dá uma ' +
        'olhada antes da divulgação oficial:\n\n' +
        `${link}\n\n` +
        'Recursos Humanos',
    },
    {
      assunto: 'Saiu a lista de promoções do semestre (prévia)',
      corpo: (nome, link) =>
        `Oi, ${nome}!\n\n` +
        'A lista de promoções deste semestre já circula internamente em prévia. Confira antes que ' +
        'saia o comunicado oficial:\n\n' +
        `${link}\n\n` +
        'Recursos Humanos',
    },
    {
      assunto: 'Você foi indicado para um reconhecimento',
      corpo: (nome, link) =>
        `Olá, ${nome}!\n\n` +
        'Seu nome apareceu numa indicação para o programa de reconhecimento interno. Dá uma olhada ' +
        'nos detalhes da indicação:\n\n' +
        `${link}\n\n` +
        'Gestão de Pessoas',
    },
    {
      assunto: 'Seu resultado da avaliação de desempenho está disponível',
      corpo: (nome, link) =>
        `Olá, ${nome}.\n\n` +
        'O resultado da sua avaliação de desempenho já foi liberado para consulta individual. Veja ' +
        'a sua nota e os comentários:\n\n' +
        `${link}\n\n` +
        'Recursos Humanos',
    },
    {
      assunto: 'As fotos da confraternização já estão no ar',
      corpo: (nome, link) =>
        `Oi, ${nome}!\n\n` +
        'Saíram as fotos da última confraternização da empresa. Tem várias boas — dá uma olhada ' +
        'antes que tirem do ar:\n\n' +
        `${link}\n\n` +
        'Comunicação Interna',
    },
    {
      assunto: 'Um novo benefício foi desbloqueado para você',
      corpo: (nome, link) =>
        `Olá, ${nome}!\n\n` +
        'Você passou a ter direito a um novo benefício neste mês. Veja do que se trata e como ' +
        'ativar:\n\n' +
        `${link}\n\n` +
        'Departamento de Benefícios',
    },
    {
      assunto: 'Resultado do sorteio interno — confira se você ganhou',
      corpo: (nome, link) =>
        `Oi, ${nome}!\n\n` +
        'Saiu o resultado do sorteio do programa interno de reconhecimento. Confira a lista e veja ' +
        'se o seu nome está nela:\n\n' +
        `${link}\n\n` +
        'Endomarketing',
    },
    {
      assunto: 'Prévia do calendário de feriados e folgas de 2027',
      corpo: (nome, link) =>
        `Olá, ${nome}!\n\n` +
        'Já circula a prévia do calendário de feriados e pontos facultativos de 2027. Dá para ' +
        'planejar as folgas com antecedência:\n\n' +
        `${link}\n\n` +
        'Departamento Pessoal',
    },
    {
      assunto: 'Organograma novo — veja como ficou sua área',
      corpo: (nome, link) =>
        `Oi, ${nome}!\n\n` +
        'Saiu o novo organograma com as mudanças de área. Dá uma olhada em como ficou a sua antes ' +
        'do anúncio oficial:\n\n' +
        `${link}\n\n` +
        'Comunicação Interna',
    },
    {
      assunto: 'Responda a pesquisa e ganhe um vale',
      corpo: (nome, link) =>
        `Olá, ${nome}!\n\n` +
        'Estamos com uma pesquisa rápida e quem responde concorre a um vale-presente. Leva menos ' +
        'de dois minutos:\n\n' +
        `${link}\n\n` +
        'Endomarketing',
    },
    {
      assunto: 'A tabela de bônus vazou — confira antes',
      corpo: (nome, link) =>
        `Oi, ${nome}!\n\n` +
        'Uma prévia da tabela de bônus começou a circular internamente. Dá uma olhada enquanto ' +
        'ainda está disponível:\n\n' +
        `${link}\n\n` +
        '(enviado por um colega)',
    },
    {
      assunto: 'Convite: programa exclusivo para alguns colaboradores',
      corpo: (nome, link) =>
        `Olá, ${nome}!\n\n` +
        'Você foi selecionado para um programa interno exclusivo, aberto a poucos colaboradores. ' +
        'Veja o convite e os detalhes:\n\n' +
        `${link}\n\n` +
        'Desenvolvimento Organizacional',
    },
  ],
};

/** Template usado quando o da campanha não existe (mesma escolha do serviço antigo). */
export const TEMPLATE_PADRAO_ISCA = 'urgencia';
