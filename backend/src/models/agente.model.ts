import { z } from 'zod';
import type { Workstation, WorkstationPort, WorkstationSoftware } from '@prisma/client';
import { regra, texto, umDe } from '../utils/esquemas.js';

// Model do agente de estacao (B07): o osquery falando com o servidor pelo plugin "tls"
// (https://osquery.readthedocs.io/en/stable/deployment/remote/). Tipos do dominio, regras
// zod do corpo de cada endpoint (enroll, config, logger) e a configuracao entregue ao agente.

/** Estacao inscrita (tabela Workstation). */
export type Estacao = Workstation;
export type ProgramaEstacao = WorkstationSoftware;
export type PortaEstacao = WorkstationPort;

// ---- Regras de entrada (na ordem em que sao conferidas) -------------------------

/** Chave da estacao como o servidor a entrega: 256 bits em hexadecimal. */
const nodeKey = z.string().regex(/^[0-9a-f]{64}$/);

/** POST /agentes/osquery/enroll. O segredo ausente nao e erro de formato: vira 401 no service. */
export const INSCRICAO = [
  regra('enroll_secret', z.string().max(1024).optional(), 'Segredo de inscrição inválido', 'SEGREDO_INVALIDO'),
  regra('host_identifier', texto.pipe(z.string().max(255)), 'Identificador da estação inválido', 'HOST_IDENTIFIER_INVALIDO'),
  regra('host_details', z.record(z.string(), z.unknown()).optional(), 'Detalhes da estação inválidos', 'HOST_DETAILS_INVALIDO'),
];

/** POST /agentes/osquery/config. */
export const CONFIG = [regra('node_key', nodeKey, 'Chave da estação inválida', 'NODE_KEY_INVALIDA')];

export const TIPOS_LOG = ['result', 'status'];
/** Limite de eventos por envio (o osquery manda no maximo --logger_tls_max_lines, 1024 por padrao). */
export const MAX_EVENTOS_LOG = 5000;

/** POST /agentes/osquery/logger. */
export const LOGGER = [
  regra('node_key', nodeKey, 'Chave da estação inválida', 'NODE_KEY_INVALIDA'),
  regra('log_type', umDe(TIPOS_LOG), 'Tipo de log inválido', 'LOG_TYPE_INVALIDO'),
  regra('data', z.array(z.unknown()).max(MAX_EVENTOS_LOG), 'Dados do log inválidos', 'DATA_INVALIDO'),
];

// ---- Configuracao entregue ao osquery -------------------------------------------

export type CategoriaQuery = 'programas' | 'sistema' | 'portas';
export const FONTES_PROGRAMA = ['programs', 'deb_packages', 'rpm_packages', 'apps'] as const;
export type FontePrograma = (typeof FONTES_PROGRAMA)[number];

interface QueryAgendada {
  query: string;
  /** Filtro de plataforma do osquery (a query so roda nesse sistema). */
  platform?: 'windows' | 'linux' | 'darwin';
  categoria: CategoriaQuery;
  fonte?: FontePrograma;
}

/**
 * Queries do inventario. Todas rodam como snapshot: cada resultado traz a lista inteira e
 * substitui a anterior da mesma fonte (o servidor guarda so o inventario mais recente).
 * As colunas saem com os nomes que o service le (name, version, fornecedor...).
 */
export const QUERIES: Record<string, QueryAgendada> = {
  baluarte_programas_windows: {
    query: 'SELECT name, version, publisher AS fornecedor FROM programs;',
    platform: 'windows',
    categoria: 'programas',
    fonte: 'programs',
  },
  baluarte_programas_deb: {
    // source: pacote-fonte, que e como o Debian e o Ubuntu indexam as vulnerabilidades no OSV (B14).
    query: 'SELECT name, version, maintainer AS fornecedor, source AS origem FROM deb_packages;',
    platform: 'linux',
    categoria: 'programas',
    fonte: 'deb_packages',
  },
  baluarte_programas_rpm: {
    // Versao completa epoch:versao-release: sem a epoch, o OSV compararia "3.0.7-27.el9" com
    // "1:3.0.7-25.el9_3" e daria o pacote ja corrigido como vulneravel (B14).
    query:
      "SELECT name, CASE WHEN CAST(epoch AS INTEGER) > 0 THEN epoch || ':' ELSE '' END || version || CASE WHEN release = '' THEN '' ELSE '-' || release END AS version, vendor AS fornecedor FROM rpm_packages;",
    platform: 'linux',
    categoria: 'programas',
    fonte: 'rpm_packages',
  },
  baluarte_programas_macos: {
    query: 'SELECT name, bundle_short_version AS version, bundle_identifier AS fornecedor FROM apps;',
    platform: 'darwin',
    categoria: 'programas',
    fonte: 'apps',
  },
  baluarte_sistema: {
    query: 'SELECT name, version, build, platform FROM os_version;',
    categoria: 'sistema',
  },
  baluarte_portas: {
    query:
      'SELECT DISTINCT lp.port, lp.protocol, lp.address, p.name AS processo FROM listening_ports lp LEFT JOIN processes p ON p.pid = lp.pid WHERE lp.port > 0;',
    categoria: 'portas',
  },
};

/** Intervalo padrao das queries: 1 h em producao, 5 min fora dela. OSQUERY_INTERVALO_S muda. */
export const INTERVALO_PRODUCAO_S = 3600;
export const INTERVALO_DEV_S = 300;
export const INTERVALO_MIN_S = 60;
export const INTERVALO_MAX_S = 86400;

// ---- Formato dos dados recebidos ------------------------------------------------

/** Evento de resultado do osquery (so o que o servidor usa; o resto e ignorado). */
export const eventoResultado = z.object({
  name: z.string(),
  snapshot: z.array(z.record(z.string(), z.unknown())).optional(),
});

const campo = (max: number) => z.string().trim().max(max);
// Coluna ausente vale como vazia (o zod 4 recusaria a linha inteira): o osquery com a
// configuracao anterior a uma coluna nova (ex.: source do deb, B14) continua sendo aceito.
const opcionalTexto = (max: number) =>
  z
    .unknown()
    .optional()
    .transform((v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null));

export const linhaPrograma = z.object({
  name: campo(512).min(1),
  version: opcionalTexto(255).transform((v) => v ?? ''),
  fornecedor: opcionalTexto(255),
  origem: opcionalTexto(512),
});

export const linhaSistema = z.object({
  name: opcionalTexto(255),
  version: opcionalTexto(255),
  build: opcionalTexto(255),
  platform: opcionalTexto(64),
});

/** protocol do listening_ports e o numero IP do protocolo (6 = TCP, 17 = UDP). */
export const PROTOCOLOS: Record<string, 'TCP' | 'UDP'> = { '6': 'TCP', '17': 'UDP' };

export const linhaPorta = z.object({
  port: z.coerce.number().int().min(1).max(65535),
  protocol: z.coerce.string().refine((p) => p in PROTOCOLOS),
  address: campo(64),
  processo: opcionalTexto(255),
});

/** host_details da inscricao: as tabelas os_version e system_info que o osquery manda. */
export const detalhesInscricao = z
  .object({
    os_version: linhaSistema.partial().optional().catch(undefined),
    system_info: z
      .object({ hostname: opcionalTexto(253), computer_name: opcionalTexto(255) })
      .partial()
      .optional()
      .catch(undefined),
  })
  .catch({});

export interface SistemaOperacional {
  sistema: string;
  soNome: string | null;
  soVersao: string | null;
  soBuild: string | null;
  soPlataforma: string | null;
}

export interface ItemPrograma {
  nome: string;
  versao: string;
  fornecedor: string | null;
  /** Pacote-fonte do deb (coluna source); null quando e o proprio nome ou nos outros sistemas. */
  pacoteOrigem: string | null;
}

export interface ItemPorta {
  porta: number;
  protocolo: 'TCP' | 'UDP';
  endereco: string;
  processo: string | null;
}
