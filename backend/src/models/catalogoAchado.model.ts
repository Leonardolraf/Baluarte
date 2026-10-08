import { notaCvss, cweValido, cveValido } from '../services/cvss.service.js';
import type { Prisma } from '@prisma/client';
import { faixaCvss } from '../services/cvss.service.js';

// Catalogo de tipos de falha do scanner simulado (e do seed de demonstracao).
// Cada tipo traz a classificacao (OWASP, CWE, vetor CVSS 3.1, CVE quando houver) e os
// passos de correcao. A nota NAO e digitada: sai do vetor, e a severidade sai da nota.

export type Esforco = 'baixo' | 'medio' | 'alto';
export interface PassoRemediacao { titulo: string; descricao: string; esforco: Esforco }

export interface TipoAchado {
  categoriaOwasp: string;
  cwe: string;
  cvssVetor: string;
  cve?: string;
  descricao: string;
  evidencia: string;
  remediacao: PassoRemediacao[];
}

export const CATALOGO_ACHADOS = {
  'controle-acesso': {
    categoriaOwasp: 'A01:2021 - Broken Access Control',
    cwe: 'CWE-862',
    cvssVetor: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N',
    descricao: 'Endpoint administrativo acessivel sem verificacao de perfil.',
    evidencia: 'GET /api/admin/users -> 200 com token de Colaborador.',
    remediacao: [
      { titulo: 'Verificar o perfil no servidor', descricao: 'Toda rota administrativa deve checar o perfil do usuário autenticado no backend, nunca confiar só no que a interface esconde.', esforco: 'medio' },
      { titulo: 'Negar por padrão', descricao: 'Aplicar o controle de acesso como middleware central, liberando cada rota explicitamente por perfil.', esforco: 'medio' },
      { titulo: 'Cobrir com teste de autorização', descricao: 'Criar testes que chamem a rota com cada perfil e esperem 403 para os não autorizados.', esforco: 'baixo' },
    ],
  },
  'idor': {
    categoriaOwasp: 'A01:2021 - Broken Access Control',
    cwe: 'CWE-639',
    cvssVetor: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N',
    descricao: 'IDOR: o identificador na URL da acesso ao perfil de outro usuario.',
    evidencia: 'GET /api/users/2 com token do usuario 1 -> 200 com os dados do usuario 2.',
    remediacao: [
      { titulo: 'Checar a posse do recurso', descricao: 'Antes de devolver o registro, confirmar no servidor que ele pertence ao usuário autenticado (ou que o perfil permite ver o de terceiros).', esforco: 'medio' },
      { titulo: 'Testar com dois usuários', descricao: 'Adicionar teste automatizado que tenta ler o recurso de outro usuário e espera 403 ou 404.', esforco: 'baixo' },
    ],
  },
  'injecao-sql': {
    categoriaOwasp: 'A03:2021 - Injection',
    cwe: 'CWE-89',
    cvssVetor: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    descricao: 'Parametro de busca concatenado diretamente na query SQL.',
    evidencia: "GET /buscar?q=' OR '1'='1 retornou todos os registros.",
    remediacao: [
      { titulo: 'Usar consultas parametrizadas', descricao: 'Substituir a concatenação de strings por prepared statements ou pelo ORM, que separam o comando SQL dos dados.', esforco: 'medio' },
      { titulo: 'Validar a entrada', descricao: 'Aceitar no parâmetro de busca apenas o formato esperado (tamanho e caracteres) e rejeitar o resto.', esforco: 'baixo' },
      { titulo: 'Reduzir o privilégio do banco', descricao: 'A conta usada pela aplicação deve ter só as permissões necessárias, limitando o estrago de uma injeção.', esforco: 'medio' },
    ],
  },
  'injecao-comando': {
    categoriaOwasp: 'A03:2021 - Injection',
    cwe: 'CWE-78',
    cvssVetor: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H',
    descricao: 'Nome do arquivo enviado e repassado sem tratamento a um comando do sistema.',
    evidencia: 'Upload com filename=x;id executou o comando id no servidor.',
    remediacao: [
      { titulo: 'Não chamar o shell', descricao: 'Trocar a execução via shell por APIs da linguagem ou por execução com lista de argumentos, sem interpolar texto do usuário.', esforco: 'medio' },
      { titulo: 'Gerar o nome do arquivo no servidor', descricao: 'Ignorar o nome enviado e salvar com um identificador aleatório gerado pela aplicação.', esforco: 'baixo' },
    ],
  },
  'cookie-inseguro': {
    categoriaOwasp: 'A02:2021 - Cryptographic Failures',
    cwe: 'CWE-614',
    cvssVetor: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:N/A:N',
    descricao: 'Cookie de sessao sem atributo Secure/HttpOnly.',
    evidencia: 'Set-Cookie: sid=...; sem flags Secure e HttpOnly.',
    remediacao: [
      { titulo: 'Ativar Secure e HttpOnly', descricao: 'Emitir o cookie de sessão com Secure (só HTTPS) e HttpOnly (inacessível ao JavaScript).', esforco: 'baixo' },
      { titulo: 'Definir SameSite', descricao: 'Usar SameSite=Lax ou Strict para reduzir o envio do cookie em requisições de outros sites.', esforco: 'baixo' },
    ],
  },
  'exposicao-versao': {
    categoriaOwasp: 'A05:2021 - Security Misconfiguration',
    cwe: 'CWE-200',
    cvssVetor: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N',
    descricao: 'Cabecalho X-Powered-By expoe versao do servidor.',
    evidencia: 'Response header: X-Powered-By: Express 4.x.',
    remediacao: [
      { titulo: 'Remover o cabeçalho', descricao: 'Desligar o X-Powered-By (no Express: app.disable("x-powered-by")) e outros cabeçalhos que revelam tecnologia e versão.', esforco: 'baixo' },
    ],
  },
  'cors-curinga': {
    categoriaOwasp: 'A05:2021 - Security Misconfiguration',
    cwe: 'CWE-942',
    cvssVetor: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:N/A:N',
    descricao: 'CORS liberado para qualquer origem.',
    evidencia: 'Access-Control-Allow-Origin: *',
    remediacao: [
      { titulo: 'Listar as origens permitidas', descricao: 'Trocar o curinga por uma lista explícita das origens do frontend, configurada por ambiente.', esforco: 'baixo' },
    ],
  },
  'sem-bloqueio-login': {
    categoriaOwasp: 'A07:2021 - Identification and Authentication Failures',
    cwe: 'CWE-307',
    cvssVetor: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N',
    descricao: 'Ausencia de bloqueio apos multiplas tentativas de login.',
    evidencia: '100 tentativas em 10s sem rate limit.',
    remediacao: [
      { titulo: 'Limitar tentativas', descricao: 'Bloquear temporariamente por conta e por origem após poucas falhas seguidas (ex.: 5 em 15 minutos).', esforco: 'medio' },
      { titulo: 'Registrar e alertar', descricao: 'Gravar as falhas de login e alertar quando houver picos, para detectar ataques de força bruta.', esforco: 'medio' },
    ],
  },
  'sessao-sem-expiracao': {
    categoriaOwasp: 'A07:2021 - Identification and Authentication Failures',
    cwe: 'CWE-613',
    cvssVetor: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:L/A:N',
    descricao: 'Token JWT emitido sem expiracao.',
    evidencia: 'Claim exp ausente no payload do token.',
    remediacao: [
      { titulo: 'Definir expiração curta', descricao: 'Emitir o token com exp (minutos, não dias) e renovar a sessão de forma controlada.', esforco: 'baixo' },
      { titulo: 'Permitir revogação', descricao: 'Invalidar os tokens antigos na troca de senha e na desativação da conta.', esforco: 'medio' },
    ],
  },
  'componente-vulneravel': {
    categoriaOwasp: 'A06:2021 - Vulnerable and Outdated Components',
    cwe: 'CWE-1321',
    cve: 'CVE-2019-10744',
    cvssVetor: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:H',
    descricao: 'Dependencia com CVE conhecido em uso (lodash, prototype pollution).',
    evidencia: 'lodash@4.17.11 no package-lock.json.',
    remediacao: [
      { titulo: 'Atualizar a dependência', descricao: 'Subir o lodash para 4.17.12 ou superior, que corrige a falha, e rodar os testes.', esforco: 'baixo' },
      { titulo: 'Automatizar a checagem', descricao: 'Rodar npm audit (ou ferramenta equivalente) no CI para barrar dependências com CVE conhecido.', esforco: 'medio' },
    ],
  },
} satisfies Record<string, TipoAchado>;

export type ChaveAchado = keyof typeof CATALOGO_ACHADOS;

/** Dados de um Finding (sem scanId) a partir do catalogo: nota calculada do vetor. */
export function dadosAchado(chave: ChaveAchado) {
  const t: TipoAchado = CATALOGO_ACHADOS[chave];
  const cvss = notaCvss(t.cvssVetor);
  if (cvss === null || !cweValido(t.cwe) || (t.cve !== undefined && !cveValido(t.cve)))
    throw new Error(`catalogo de achados invalido: ${chave}`);
  return {
    categoriaOwasp: t.categoriaOwasp,
    descricao: t.descricao,
    evidencia: t.evidencia,
    cwe: t.cwe,
    cve: t.cve ?? null,
    cvssVetor: t.cvssVetor,
    cvss,
    severidade: faixaCvss(cvss),
    remediacao: t.remediacao as unknown as Prisma.InputJsonValue,
  };
}

function passoValido(p: unknown): p is PassoRemediacao {
  const x = p as Record<string, unknown> | null;
  return !!x && typeof x.titulo === 'string' && typeof x.descricao === 'string' && ['baixo', 'medio', 'alto'].includes(x.esforco as string);
}

/**
 * Passos de correcao gravados no Finding (coluna JSONB), numerados para a API.
 * O banco garante que e uma lista; passos fora do formato sao descartados em vez de quebrar a tela.
 */
export function lerRemediacao(valor: unknown): Array<PassoRemediacao & { ordem: number }> {
  if (!Array.isArray(valor)) return [];
  return valor.filter(passoValido).map((p, i) => ({ ordem: i + 1, titulo: p.titulo, descricao: p.descricao, esforco: p.esforco }));
}
