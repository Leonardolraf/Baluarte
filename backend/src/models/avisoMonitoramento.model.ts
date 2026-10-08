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
// RASCUNHO: o texto abaixo ainda precisa ser aprovado pelo Leo e, numa empresa real, pelo
// encarregado pelo tratamento de dados pessoais (art. 41 da LGPD). Enquanto for rascunho,
// AVISO_RASCUNHO fica true e a tela mostra isso. Ao aprovar, ou a qualquer mudanca no texto,
// troque VERSAO_AVISO: a ciencia e por versao, entao todos precisam ler e registrar de novo.
//
// O que o texto diz que e coletado tem de bater com QUERIES em models/agente.model.ts; o
// teste tests/aviso-monitoramento.test.ts le a configuracao entregue ao osquery e falha se
// aparecer consulta fora de programas, sistema operacional e portas. A frequencia de cada
// categoria nao e digitada: sai de INTERVALO_PRODUCAO_S e FATOR_INTERVALO (B08), pela mesma
// conta da configuracao, e o teste a confere contra a configuracao de producao.

/** Registro de ciencia como esta no banco (tabela MonitoringAcknowledgement). */
export type CienciaMonitoramento = MonitoringAcknowledgement;

/** Versao do texto em vigor. Mudou o texto, mudou a versao (a ciencia antiga nao vale para a nova). */
export const VERSAO_AVISO = '2026-10-08';

/** O texto ainda nao foi aprovado (ver o comentario do topo). */
export const AVISO_RASCUNHO = true;

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
  titulo: 'Aviso sobre o monitoramento da estação de trabalho',
  introducao:
    'A empresa usa o Baluarte para encontrar falhas de segurança nos computadores de trabalho antes que alguém as aproveite. Para isso, um programa chamado agente (o osquery) fica instalado na sua estação e envia ao Baluarte um inventário técnico da máquina: ' +
    `as portas de rede abertas a cada ${frequenciaEmProducao('portas')}, a lista de programas instalados a cada ${frequenciaEmProducao('programas')} e a versão do sistema operacional a cada ${frequenciaEmProducao('sistema')}. ` +
    'Este aviso explica o que o agente coleta, o que ele não coleta e para que isso serve.',
  secoes: [
    {
      id: 'coletado',
      titulo: 'O que é coletado',
      paragrafos: [],
      itens: [
        'A lista de programas instalados, com a versão e o fornecedor de cada um.',
        'O nome e a versão do sistema operacional.',
        'As portas de rede abertas na máquina (por onde ela aceita conexões) e o nome do programa que abriu cada uma.',
        'O nome da máquina, um identificador técnico do equipamento e a data e a hora do último contato do agente, que mostram se a estação está ligada e conectada.',
      ],
      observacoes: [],
    },
    {
      id: 'nao-coletado',
      titulo: 'O que não é coletado',
      paragrafos: ['O agente não lê nem envia ao Baluarte:'],
      itens: [
        'arquivos e documentos;',
        'e-mails;',
        'histórico de navegação;',
        'o que você digita no teclado;',
        'imagens da tela;',
        'a sua localização.',
      ],
      observacoes: [
        'A análise de arquivos do portal só acontece quando você mesmo envia um arquivo; ela não tem relação com o agente.',
      ],
    },
    {
      id: 'finalidade',
      titulo: 'Para que serve',
      paragrafos: [
        'Para encontrar programas vulneráveis: o nome e a versão de cada programa são comparados com bases públicas de vulnerabilidades conhecidas, e as portas abertas mostram serviços expostos sem necessidade. Com isso a equipe de segurança sabe o que precisa ser atualizado ou corrigido.',
        'O Baluarte não usa esses dados para medir produtividade nem o horário de uso da máquina.',
      ],
      itens: [],
      observacoes: [],
    },
    {
      id: 'acesso',
      titulo: 'Quem vê',
      paragrafos: [
        'Só os perfis Administrador e Analista do Baluarte veem o inventário das estações. O perfil Colaborador não vê o inventário de nenhuma máquina.',
      ],
      itens: [],
      observacoes: [],
    },
    {
      id: 'retencao',
      titulo: 'Por quanto tempo fica guardado',
      paragrafos: [
        'O Baluarte guarda só o inventário mais recente de cada estação: cada nova coleta substitui a anterior. As vulnerabilidades encontradas a partir dele viram achados de segurança e seguem a política de gestão de vulnerabilidades da empresa.',
      ],
      itens: [],
      observacoes: [],
    },
    {
      id: 'base-legal',
      titulo: 'Base legal',
      paragrafos: [
        'O tratamento se apoia no legítimo interesse da empresa em proteger os seus sistemas e informações (art. 7º, inciso IX, da Lei Geral de Proteção de Dados Pessoais, a LGPD) e no dever de adotar medidas de segurança para proteger os dados pessoais (art. 46 da LGPD).',
      ],
      itens: [],
      observacoes: [],
    },
    {
      id: 'duvidas',
      titulo: 'Dúvidas',
      paragrafos: [
        'Fale com a equipe de segurança da informação (os administradores do Baluarte) ou com o encarregado pelo tratamento de dados pessoais da empresa.',
      ],
      itens: [],
      observacoes: [],
    },
    {
      id: 'ciencia',
      titulo: 'Sua ciência',
      paragrafos: [
        'Ao clicar em "Li e estou ciente", você confirma que leu este aviso. A ciência não é um pedido de consentimento: ela registra que você foi informado. Ficam guardados quem registrou, quando e a versão do texto. Se o texto mudar, uma nova ciência será pedida.',
      ],
      itens: [],
      observacoes: [],
    },
  ],
};

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
