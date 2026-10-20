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
  return destinatariosInternos().dominios[0] ?? DOMINIO_INTERNO_PADRAO;
}

/**
 * DT19: DOMINIO_INTERNO aceita uma lista (virgula, ponto e virgula ou espaco) de dominios
 * (`@baluarte.test` ou `baluarte.test`) e de enderecos liberados um a um
 * (`pessoa@gmail.com`), para a demonstracao mandar campanha a uma caixa real sem liberar o
 * dominio inteiro de um provedor. Sem entrada valida: so o dominio padrao.
 */
export function destinatariosInternos(): { dominios: string[]; enderecos: string[] } {
  const { dominios, enderecos } = entradasDominioInterno();
  if (!dominios.length && !enderecos.length) dominios.push(DOMINIO_INTERNO_PADRAO);
  return { dominios, enderecos };
}

/** As entradas de DOMINIO_INTERNO como vieram (minusculas, dominio sempre com '@'), sem o padrao. */
function entradasDominioInterno(): { dominios: string[]; enderecos: string[] } {
  const dominios: string[] = [];
  const enderecos: string[] = [];
  for (const bruto of (process.env.DOMINIO_INTERNO ?? '').toLowerCase().split(/[\s,;]+/)) {
    if (!bruto) continue;
    const arroba = bruto.indexOf('@');
    if (arroba > 0) enderecos.push(bruto);
    else dominios.push(arroba === 0 ? bruto : `@${bruto}`);
  }
  return { dominios, enderecos };
}

const ROTULO = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
/** `@rotulo.rotulo[...]`: pelo menos um ponto (pega `@baluarte`, `@@x.com`, `@x..com`). */
const DOMINIO_VALIDO = new RegExp(`^@${ROTULO}(?:\\.${ROTULO})+$`);
const ENDERECO_VALIDO = new RegExp(`^[^\\s@]+@${ROTULO}(?:\\.${ROTULO})+$`);
/** O dominio do contrato N2 AT1 tem dono (DT28): vale em dev e teste, nunca em producao. */
const ehDominioDoContrato = (entrada: string) =>
  entrada.endsWith(DOMINIO_INTERNO_PADRAO) || entrada.endsWith(`.${DOMINIO_INTERNO_PADRAO.slice(1)}`);

/**
 * DT28: falha cedo se DOMINIO_INTERNO nao servir para producao. Chamar antes do listen(),
 * junto de validarSegredoJwt(). Em producao exige pelo menos uma entrada, todas validas e
 * nenhuma no dominio do contrato (`@empresa.com`, que e de um terceiro real). Fora de
 * producao nao faz nada: sem a variavel, o padrao continua `@empresa.com` (Newman, Robot,
 * seed de contrato e testes).
 * Por que recusar em vez de cair num padrao reservado (ex.: `@baluarte.test`): a producao mal
 * configurada falharia EM SILENCIO (campanha para dominio inexistente, ninguem recebe e nada
 * avisa). Recusar a subida transforma esse erro silencioso em erro visivel no log.
 */
export function validarDominioInterno(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const { dominios, enderecos } = entradasDominioInterno();
  const entradas = [...dominios, ...enderecos];
  if (!entradas.length) {
    throw new Error('DOMINIO_INTERNO é obrigatório em produção: defina o domínio da empresa que recebe as campanhas '
      + '(ex.: DOMINIO_INTERNO=@minhaempresa.com.br). Sem ele o padrão seria @empresa.com, domínio de um terceiro.');
  }
  const invalidas = [...dominios.filter((d) => !DOMINIO_VALIDO.test(d)), ...enderecos.filter((e) => !ENDERECO_VALIDO.test(e))];
  if (invalidas.length) {
    throw new Error(`DOMINIO_INTERNO inválido em produção: ${invalidas.join(', ')}. Use domínios (@minhaempresa.com.br) `
      + 'ou endereços (pessoa@dominio.com) separados por vírgula.');
  }
  const doContrato = entradas.filter(ehDominioDoContrato);
  if (doContrato.length) {
    throw new Error(`DOMINIO_INTERNO não pode usar ${DOMINIO_INTERNO_PADRAO} em produção (${doContrato.join(', ')}): `
      + 'é o domínio de um terceiro real, usado só pelo contrato de teste N2 AT1. Defina o domínio da empresa.');
  }
}

/**
 * Flag aditivo (allowlist, decisao do Leo em 21/10/2026): com CAMPANHA_SEM_TRAVA_DOMINIO=1 a
 * trava de dominio da campanha cai e QUALQUER usuario cadastrado e Ativo pode ser destinatario,
 * de qualquer dominio (gmail, outlook, ...). O gate continua sendo "Ativo cadastrado"
 * (CampaignEvent.userId obrigatorio) — o administrador, que cadastra, e quem controla.
 * DEFAULT OFF (ausente ou != '1'): comportamento de sempre, contrato N2 AT1 intacto (o CT-C2 do
 * Newman manda gmail e exige 422 DESTINATARIO_EXTERNO). Lido a cada chamada para os testes
 * ligarem/desligarem. So e ligado por ambiente na VM; os testes apagam a variavel (helpers.ts).
 */
export function travaDeDominioDesligada(): boolean {
  return process.env.CAMPANHA_SEM_TRAVA_DOMINIO === '1';
}

/** O e-mail pode receber campanha: termina num dominio interno ou esta liberado na lista. */
export function destinatarioInterno(email: string): boolean {
  if (travaDeDominioDesligada()) return true;
  const e = email.trim().toLowerCase();
  const { dominios, enderecos } = destinatariosInternos();
  return enderecos.includes(e) || dominios.some((d) => e.endsWith(d));
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
