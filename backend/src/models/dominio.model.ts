// Constantes de dominio (iguais ao stub)
/** Tipo do ativo criado pela inscricao do agente osquery (B07); nao se cadastra pela interface. */
export const TIPO_ESTACAO = 'Estação de trabalho';
/** Tipos aceitos no cadastro manual (POST /assets, contrato N2 AT1). */
export const TIPOS_ATIVO_CADASTRO = ['Servidor', 'Aplicacao', 'Rede', 'Banco de Dados'];
/** Todos os tipos validos no banco (CHECK Asset_tipo_check). */
export const TIPOS_ATIVO = [...TIPOS_ATIVO_CADASTRO, TIPO_ESTACAO];
export const PERFIS = ['Administrador', 'Analista', 'Colaborador'];
export const TEMPLATES = ['urgencia', 'autoridade', 'curiosidade'];
/** Dominio interno padrao dos destinatarios de campanha (o do contrato N2 AT1). */
export const DOMINIO_INTERNO_PADRAO = '@empresa.com';

/**
 * Dominio interno aceito como destinatario de campanha: variavel de ambiente
 * DOMINIO_INTERNO (ex.: `@minhaempresa.com.br` ou `minhaempresa.com.br`), com
 * '@empresa.com' como padrao. Lido a cada chamada, sempre em minusculas e com '@'.
 */
export function dominioInterno(): string {
  const valor = (process.env.DOMINIO_INTERNO ?? '').trim().toLowerCase();
  if (!valor) return DOMINIO_INTERNO_PADRAO;
  return valor.startsWith('@') ? valor : `@${valor}`;
}

// Constantes de dominio das rotas adicionais (fora do contrato da N2 AT1)
export const STATUS_USUARIO = ['Ativo', 'Inativo', 'Pendente'];
/** Severidades de achado, da mais grave para a mais leve (espelha a CHECK Finding_severidade_check). */
export const SEVERIDADES = ['Crítico', 'Alto', 'Médio', 'Baixo'];
export const STATUS_FINDING = ['Aberta', 'Em revisão', 'Em remediação', 'Resolvida', 'Risco aceito'];
/** Status de achado que NAO contam como risco em aberto no dashboard. */
export const STATUS_FINDING_ENCERRADO = ['Resolvida', 'Risco aceito'];
/** Status com que todo achado nasce (default de Finding.status; CHECK FindingStatusChange_criacao_check). */
export const STATUS_INICIAL_FINDING = 'Aberta';

/**
 * Peso de cada achado ABERTO por severidade: o UNICO lugar que define a escala de risco (B25b).
 * Usado pela nota de risco por ativo (services/riscoAtivo.service.ts), pelo indice de risco
 * tecnico global do dashboard (`kpis.indiceRiscoTecnico`) e pela evolucao do risco em 30 dias
 * (services/indiceRisco.service.ts). O frontend nao tem formula propria: le os numeros prontos.
 *
 * Escala 10/7/4/1, aprovada pelo Leo em 10/10/2026 (cartao DT07 no Trello): o piso da faixa
 * CVSS 3.1 de cada severidade (Critico 9,0 arredondado para 10; Alto 7,0; Medio 4,0; Baixo 0,1
 * arredondado para 1). Ate o B25b o indice global do frontend usava 10/6/3/1. Trocar a escala
 * e mudar SO esta constante (e o teste de unidade que a fixa); nota, indice e evolucao acompanham.
 */
export const PESO_SEVERIDADE: Readonly<Record<string, number>> = { 'Crítico': 10, 'Alto': 7, 'Médio': 4, 'Baixo': 1 };

/**
 * Pesos do risco humano do dashboard (`kpis.riscoHumano`): o UNICO lugar que define a formula
 * (services/campanhaMetricas.service.ts#riscoHumano), sobre todas as campanhas:
 * `min(100, taxa de clique % x clique + taxa de submissao de credenciais % x submissao)`.
 * Com 2/2, 50 % de cliques sozinhos ja e risco maximo, e quem entrega a senha pesa de novo
 * (todo submetedor tambem clicou). Aprovado pelo Leo em 10/10/2026; ate entao o frontend
 * calculava clique x 2,5 sem a submissao, contra o texto da tela e contra o mock (2/2).
 */
export const PESO_RISCO_HUMANO = { clique: 2, submissao: 2 } as const;

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
