// Constantes de dominio (iguais ao stub)
export const TIPOS_ATIVO = ['Servidor', 'Aplicacao', 'Rede', 'Banco de Dados'];
export const PERFIS = ['Administrador', 'Analista', 'Colaborador'];
export const TEMPLATES = ['urgencia', 'autoridade', 'curiosidade'];
export const DOMINIO_INTERNO = '@empresa.com';

// Constantes de dominio das rotas adicionais (fora do contrato da N2 AT1)
export const STATUS_USUARIO = ['Ativo', 'Inativo', 'Pendente'];
export const STATUS_FINDING = ['Aberta', 'Em revisão', 'Em remediação', 'Resolvida', 'Risco aceito'];
/** Status de achado que NAO contam como risco em aberto no dashboard. */
export const STATUS_FINDING_ENCERRADO = ['Resolvida', 'Risco aceito'];

/** Perfis que operam a plataforma (varreduras, ativos, campanhas, listas tecnicas). */
export const OPERADORES = ['Administrador', 'Analista'];

/** Rotulo de quem nao tem departamento nos relatorios agregados. */
export const SEM_DEPARTAMENTO = 'Sem departamento';
