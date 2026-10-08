// Constantes de dominio (iguais ao stub)
/** Tipo do ativo criado pela inscricao do agente osquery (B07); nao se cadastra pela interface. */
export const TIPO_ESTACAO = 'Estação de trabalho';
/** Tipos aceitos no cadastro manual (POST /assets, contrato N2 AT1). */
export const TIPOS_ATIVO_CADASTRO = ['Servidor', 'Aplicacao', 'Rede', 'Banco de Dados'];
/** Todos os tipos validos no banco (CHECK Asset_tipo_check). */
export const TIPOS_ATIVO = [...TIPOS_ATIVO_CADASTRO, TIPO_ESTACAO];
export const PERFIS = ['Administrador', 'Analista', 'Colaborador'];
export const TEMPLATES = ['urgencia', 'autoridade', 'curiosidade'];
export const DOMINIO_INTERNO = '@empresa.com';

// Constantes de dominio das rotas adicionais (fora do contrato da N2 AT1)
export const STATUS_USUARIO = ['Ativo', 'Inativo', 'Pendente'];
/** Severidades de achado, da mais grave para a mais leve (espelha a CHECK Finding_severidade_check). */
export const SEVERIDADES = ['Crítico', 'Alto', 'Médio', 'Baixo'];
export const STATUS_FINDING = ['Aberta', 'Em revisão', 'Em remediação', 'Resolvida', 'Risco aceito'];
/** Status de achado que NAO contam como risco em aberto no dashboard. */
export const STATUS_FINDING_ENCERRADO = ['Resolvida', 'Risco aceito'];

/** Perfis que operam a plataforma (varreduras, ativos, campanhas, listas tecnicas). */
export const OPERADORES = ['Administrador', 'Analista'];

/** Rotulo de quem nao tem departamento nos relatorios agregados. */
export const SEM_DEPARTAMENTO = 'Sem departamento';

// Politica de senha publicada em GET /configuracoes/seguranca e aplicada nas rotas
// de alteracao/redefinicao de senha.
export const POLITICA_SENHA = {
  comprimentoMinimo: 8,
  comprimentoMaximo: 64,
  exigirMaiusculaMinuscula: true,
  exigirNumeroEspecial: true,
} as const;
