import { createHash } from 'node:crypto';
import type { MonitoringAcknowledgement } from '@prisma/client';
import { z } from 'zod';
import { regra, regrasDePaginacao, seVeio } from '../utils/esquemas.js';
import { INTERVALO_PRODUCAO_S, intervaloDaCategoriaNoBase, type CategoriaQuery } from './agente.model.js';

// Model do aviso de monitoramento da estacao (B18, RNF-006, LGPD): o texto que explica ao
// colaborador o que o agente osquery coleta, a versao desse texto e as regras zod das rotas
// /monitoramento. Este arquivo e o LUGAR UNICO do texto: a API o serve em
// GET /monitoramento/aviso e o frontend so o exibe (o mock do frontend guarda uma copia,
// conferida contra o texto servido por tests/aviso-monitoramento.test.ts).
//
// Desde 19/10/2026 (opcao C do Leo) este aviso e o documento UNICO que todo usuario precisa
// reconhecer para usar o Baluarte: sem ciencia da VERSAO_AVISO em vigor, o gate
// exigeCienciaAviso (middlewares/auth.middleware.ts) responde 403 CIENCIA_AVISO_PENDENTE.
// E CIENCIA (legitimo interesse, art. 7o, IX, da LGPD), NAO consentimento.
//
// TEXTO: o de 19/10/2026 (versao 2026-10-19) e o texto do Leo, transcrito palavra por palavra
// das 9 secoes, sem parafrase; as frequencias das 3 frases da secao 2 saem de
// frequenciaEmProducao(). Historico: 2026-10-08 rascunho publicado na demo; 2026-10-10 texto
// aprovado em 10/10; 2026-10-19 texto atual.
//
// AO TROCAR O TEXTO (checklist): (1) VERSAO_AVISO nova (a ciencia e por versao: todos voltam a
// ser barrados pelo gate ate ler e registrar de novo); (2) HASH_TEXTO_AVISO novo (o teste
// tests/unidade/hash-aviso.test.ts recalcula e falha enquanto nao bater); (3) AVISO_RASCUNHO =
// true enquanto o texto nao estiver aprovado, false com a aprovacao do Leo; (4) a copia do mock
// do frontend (MOCK_MONITORING_NOTICE em baluarte-frontend/src/mocks/data.ts, comparada por
// tests/aviso-monitoramento.test.ts) muda junto; (5) as frequencias nunca sao digitadas: saem
// de frequenciaEmProducao(), e mudar o agendamento (FATOR_INTERVALO, INTERVALO_PRODUCAO_S)
// tambem muda o texto e exige (1) e (2).
//
// O que o texto diz que e coletado tem de bater com QUERIES em models/agente.model.ts; o
// teste tests/aviso-monitoramento.test.ts le a configuracao entregue ao osquery e falha se
// aparecer consulta fora de programas, sistema operacional e portas. A frequencia de cada
// categoria nao e digitada: sai de INTERVALO_PRODUCAO_S e FATOR_INTERVALO (B08), pela mesma
// conta da configuracao, e o teste a confere contra a configuracao de producao.

/** Registro de ciencia como esta no banco (tabela MonitoringAcknowledgement). */
export type CienciaMonitoramento = MonitoringAcknowledgement;

/**
 * Versao do texto em vigor. Mudou o texto, mudou a versao (a ciencia antiga nao vale para a nova).
 * 2026-10-08 rascunho da demo; 2026-10-10 texto aprovado em 10/10; 2026-10-19 texto do Leo.
 */
export const VERSAO_AVISO = '2026-10-19';

/**
 * SHA-256 do texto servido nesta versao (serializarTextoAviso(TEXTO_AVISO)). Fecha por
 * construcao o caso "o texto mudou e a versao nao": se o texto servido mudar (inclusive pela
 * frequencia, que sai do agendamento da coleta), tests/unidade/hash-aviso.test.ts falha ate
 * VERSAO_AVISO e esta constante serem atualizadas juntas.
 */
export const HASH_TEXTO_AVISO = '105d65df0b98e77150c46b3ee455aaa76c4e0efdc4aad5307d66711e3acdb996';

/** O texto em vigor ainda nao foi aprovado? false: texto de 19/10/2026 entregue pelo Leo. */
export const AVISO_RASCUNHO = false;

/** Secao do aviso: paragrafos, a lista de itens (quando ha) e observacoes depois da lista. */
export interface SecaoAviso {
  id: string;
  titulo: string;
  paragrafos: string[];
  itens: string[];
  observacoes: string[];
}

export interface TextoAviso {
  titulo: string;
  introducao: string;
  secoes: SecaoAviso[];
}

/** Duracao em portugues: 900 -> "15 minutos", 3600 -> "1 hora", 21600 -> "6 horas". */
export function duracaoPorExtenso(segundos: number): string {
  const [n, unidade] =
    segundos % 3600 === 0 ? [segundos / 3600, 'hora'] : segundos % 60 === 0 ? [segundos / 60, 'minuto'] : [segundos, 'segundo'];
  return `${n} ${unidade}${n === 1 ? '' : 's'}`;
}

/** Frequencia de coleta de cada categoria em producao (o padrao, sem OSQUERY_INTERVALO_S). */
export function frequenciaEmProducao(categoria: CategoriaQuery): string {
  return duracaoPorExtenso(intervaloDaCategoriaNoBase(categoria, INTERVALO_PRODUCAO_S));
}

export const TEXTO_AVISO: TextoAviso = {
  titulo: 'Aviso de Monitoramento das Estações de Trabalho e Tratamento de Dados',
  // O texto de 19/10/2026 nao tem introducao fora das secoes (a secao 1 cumpre esse papel).
  introducao: '',
  secoes: [
    {
      id: 'sobre',
      titulo: '1. Sobre o monitoramento',
      paragrafos: [
        'O Baluarte é uma plataforma de cibersegurança utilizada para identificar vulnerabilidades, acompanhar riscos tecnológicos e contribuir para a proteção dos sistemas e das informações da organização.',
        'Para auxiliar nessa proteção, a empresa poderá utilizar um agente de monitoramento técnico denominado osquery, instalado nas estações de trabalho corporativas. Esse agente realiza verificações periódicas e encaminha ao Baluarte informações técnicas sobre os equipamentos monitorados.',
        'O monitoramento tem finalidade preventiva e busca identificar programas desatualizados, possíveis falhas de segurança, serviços de rede expostos e outras condições que possam representar riscos ao ambiente tecnológico da organização.',
        'Este aviso apresenta, de maneira clara e transparente, quais informações são coletadas, como são utilizadas, quem poderá acessá-las e quais são os direitos dos colaboradores em relação ao tratamento de seus dados.',
      ],
      itens: [],
      observacoes: [],
    },
    {
      id: 'coletado',
      titulo: '2. Quais informações são coletadas?',
      paragrafos: [
        'O agente realiza coletas técnicas periódicas, limitadas às informações necessárias para a identificação e o acompanhamento de riscos de segurança.',
        'As informações coletadas incluem:',
      ],
      itens: [
        `Programas instalados: nome, versão e fornecedor dos softwares presentes no equipamento. A coleta ocorre a cada ${frequenciaEmProducao('programas')}.`,
        `Sistema operacional: nome e versão do sistema operacional utilizado. A verificação ocorre a cada ${frequenciaEmProducao('sistema')}.`,
        `Portas de rede: identificação das portas abertas e dos processos ou programas associados a elas, permitindo identificar serviços potencialmente expostos. A verificação ocorre a cada ${frequenciaEmProducao('portas')}.`,
        'Identificação do equipamento: nome da estação de trabalho e identificador técnico utilizado para distinguir o dispositivo dentro da plataforma.',
        'Informações de comunicação: data e horário do último contato realizado entre o agente e o Baluarte, utilizados para acompanhar a conectividade do equipamento.',
      ],
      observacoes: [
        'Esses dados compõem um inventário técnico de segurança e permitem que a equipe responsável identifique situações que possam exigir atualização, correção ou investigação.',
      ],
    },
    {
      id: 'nao-coletado',
      titulo: '3. Quais informações NÃO são coletadas?',
      paragrafos: [
        'O monitoramento descrito neste aviso não tem como objetivo acompanhar atividades pessoais, avaliar produtividade ou fiscalizar o comportamento individual dos colaboradores.',
        'O agente, na configuração prevista para o Baluarte, não realiza a leitura, captura ou transmissão de:',
      ],
      itens: [
        'Arquivos pessoais ou documentos armazenados no computador;',
        'Conteúdo de e-mails ou mensagens particulares;',
        'Histórico de navegação na internet;',
        'Senhas ou informações digitadas no teclado;',
        'Capturas de tela, imagens ou gravações da atividade do usuário;',
        'Dados de localização geográfica do colaborador.',
      ],
      observacoes: [
        'O módulo de análise de arquivos disponível no portal Baluarte funciona de maneira independente. Nesse recurso, a análise ocorre somente quando o próprio usuário seleciona e envia um arquivo à plataforma.',
        'O monitoramento técnico também não autoriza, por si só, o acesso ao conteúdo de informações particulares eventualmente armazenadas no equipamento.',
      ],
    },
    {
      id: 'finalidade',
      titulo: '4. Para quais finalidades os dados são utilizados?',
      paragrafos: [
        'As informações coletadas são utilizadas exclusivamente para finalidades relacionadas à segurança da informação e à proteção do ambiente tecnológico da organização.',
        'Entre essas finalidades estão a identificação de softwares com vulnerabilidades conhecidas, a detecção de serviços de rede potencialmente expostos, o acompanhamento das condições de segurança dos equipamentos e o apoio à definição de medidas preventivas e corretivas.',
        'O Baluarte permite relacionar as informações do inventário técnico a referências públicas de vulnerabilidades, auxiliando a equipe de segurança na identificação de riscos e na priorização das correções necessárias.',
        'As informações coletadas não se destinam à avaliação de desempenho profissional, ao controle de produtividade ou à análise de atividades pessoais dos colaboradores.',
      ],
      itens: [],
      observacoes: [],
    },
    {
      id: 'acesso',
      titulo: '5. Quem pode acessar as informações?',
      paragrafos: [
        'O acesso ao inventário técnico das estações de trabalho é restrito aos usuários autorizados, conforme os perfis de acesso definidos na plataforma Baluarte.',
        'O Administrador possui acesso às informações de monitoramento e aos recursos necessários à administração da plataforma.',
        'O Analista pode consultar os inventários, acompanhar vulnerabilidades e executar as atividades de análise de segurança previstas para seu perfil.',
        'O Colaborador não possui permissão para consultar os inventários técnicos das estações de trabalho.',
        'Essas restrições são aplicadas por mecanismos de controle de acesso baseados em funções (RBAC), com o objetivo de impedir o acesso a recursos incompatíveis com as permissões atribuídas a cada usuário.',
        'O tratamento das informações deve observar os princípios da necessidade, finalidade, segurança e prevenção previstos na legislação de proteção de dados pessoais.',
      ],
      itens: [],
      observacoes: [],
    },
    {
      id: 'retencao',
      titulo: '6. Armazenamento e conservação das informações',
      paragrafos: [
        'O Baluarte mantém o inventário técnico mais recente de cada estação monitorada. A cada nova coleta, as informações correspondentes são atualizadas, substituindo os dados anteriores do inventário.',
        'As vulnerabilidades identificadas a partir dessas informações podem gerar registros de segurança, denominados achados, que serão mantidos conforme a política de gestão de vulnerabilidades e os critérios de retenção definidos pela organização.',
        'Os registros de ciência deste aviso são tratados separadamente do inventário técnico, para permitir a comprovação de que o colaborador recebeu as informações relativas ao monitoramento.',
        'Os dados deverão ser conservados somente pelo período necessário às finalidades informadas e às obrigações legais aplicáveis, observados os critérios de retenção da organização.',
      ],
      itens: [],
      observacoes: [],
    },
    {
      id: 'base-legal',
      titulo: '7. Proteção dos dados e conformidade com a LGPD',
      paragrafos: [
        'O tratamento de dados pessoais relacionado ao monitoramento das estações de trabalho deverá observar a Lei nº 13.709/2018, conhecida como Lei Geral de Proteção de Dados Pessoais (LGPD).',
        'Quando devidamente demonstrados os requisitos legais, esse tratamento poderá fundamentar-se no legítimo interesse da organização em proteger seus sistemas, equipamentos, informações e infraestrutura tecnológica, conforme o artigo 7º, inciso IX, e o artigo 10 da LGPD.',
        'A utilização dessa hipótese legal pressupõe a avaliação da necessidade e da proporcionalidade do tratamento, considerando também os direitos, as liberdades fundamentais e as legítimas expectativas dos titulares dos dados.',
        'A organização deverá adotar medidas técnicas e administrativas adequadas à proteção das informações tratadas, em conformidade com o artigo 46 da LGPD.',
      ],
      itens: [],
      observacoes: [],
    },
    {
      id: 'direitos',
      titulo: '8. Direitos dos colaboradores',
      paragrafos: [
        'Os colaboradores possuem os direitos previstos na LGPD, observados os requisitos e as condições estabelecidos na legislação.',
        'Entre esses direitos estão solicitar informações sobre o tratamento de seus dados pessoais, requerer a correção de dados incompletos ou inexatos, obter esclarecimentos sobre as finalidades do tratamento e apresentar oposição quando cabível.',
        'Dúvidas, solicitações ou questionamentos relacionados ao monitoramento poderão ser encaminhados à equipe responsável pela segurança da informação ou ao encarregado pelo tratamento de dados pessoais da organização, por meio dos canais oficiais disponibilizados pela empresa.',
      ],
      itens: [],
      observacoes: [],
    },
    {
      id: 'ciencia',
      titulo: '9. Registro de ciência',
      paragrafos: [
        'Ao selecionar a opção "Li e estou ciente", o colaborador declara ter recebido e tomado conhecimento das informações apresentadas neste aviso, incluindo as finalidades do monitoramento, os tipos de dados coletados, a frequência das verificações e as condições de utilização das informações.',
        'O registro de ciência não constitui solicitação de consentimento para o tratamento de dados pessoais, nem representa renúncia aos direitos assegurados pela LGPD. Sua finalidade é documentar que as informações relativas ao monitoramento foram disponibilizadas ao colaborador.',
        'Para fins de rastreabilidade e transparência, o Baluarte registra a identificação do usuário que confirmou a ciência, a data e o horário da confirmação e a versão do aviso apresentada naquele momento.',
        'Caso este aviso seja atualizado, uma nova confirmação de ciência poderá ser solicitada para assegurar que os colaboradores tomem conhecimento das alterações realizadas.',
        'O registro de ciência não substitui as responsabilidades legais da organização quanto à proteção dos dados pessoais e à utilização adequada das informações coletadas.',
      ],
      itens: [],
      observacoes: [],
    },
  ],
};

/**
 * Serializacao deterministica do texto servido (JSON com as chaves em ordem alfabetica, em
 * todos os niveis; a ordem das listas e mantida): base de HASH_TEXTO_AVISO.
 */
export function serializarTextoAviso(texto: TextoAviso = TEXTO_AVISO): string {
  const ordenar = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(ordenar)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar((v as Record<string, unknown>)[k])]))
        : v;
  return JSON.stringify(ordenar(texto));
}

/** SHA-256 (hex) da serializacao deterministica do texto. */
export function hashDoTextoAviso(texto: TextoAviso = TEXTO_AVISO): string {
  return createHash('sha256').update(serializarTextoAviso(texto), 'utf8').digest('hex');
}

// ---- DTOs -----------------------------------------------------------------------

/** GET /monitoramento/aviso: o texto, a versao e a ciencia do usuario atual nessa versao. */
export interface AvisoDto extends TextoAviso {
  versao: string;
  rascunho: boolean;
  ciencia: { registrada: boolean; registradaEm: Date | null };
}

/** POST /monitoramento/ciencia. */
export interface CienciaRegistradaDto {
  versao: string;
  registradaEm: Date;
  /** false quando a ciencia dessa versao ja existia (a rota e idempotente). */
  nova: boolean;
}

/** Item de GET /monitoramento/ciencias (so Administrador). */
export interface CienciaDto {
  id: string;
  versao: string;
  registradaEm: Date;
  usuario: { id: string; nome: string; email: string; perfil: string; status: string };
}

// ---- Regras de entrada ------------------------------------------------------------

/** Formato da versao (o mesmo da CHECK do banco). */
export const versaoAviso = z.string().regex(/^[0-9A-Za-z._-]{1,32}$/);

/**
 * POST /monitoramento/ciencia. A versao lida pela pessoa e obrigatoria: quem leu um texto
 * que mudou nesse meio-tempo recebe 409 em vez de ficar com a ciencia de um texto que nao viu.
 */
export const CIENCIA = [regra('versao', versaoAviso, 'Versão do aviso inválida', 'VERSAO_INVALIDA')];

export const TAMANHO_PADRAO = 20;
export const TAMANHO_MAXIMO = 100;

/** Query de GET /monitoramento/ciencias, na ordem em que e conferida. */
export const CONSULTA_CIENCIAS = [
  regra('versao', seVeio(versaoAviso), 'Versão do aviso inválida', 'VERSAO_INVALIDA'),
  ...regrasDePaginacao(TAMANHO_MAXIMO),
];
