import { z } from 'zod';
import type { Asset, Workstation, WorkstationPort, WorkstationSoftware } from '@prisma/client';
import { regra } from '../utils/esquemas.js';

// Model do painel de estacoes monitoradas (B13): leitura, pelo Administrador e pelo
// Analista, do que o agente osquery (B07) registrou. O protocolo do agente fica em
// agente.model.ts; aqui so ha os tipos da leitura, a regra do :id e a janela de status.

/** Estacao com o ativo e o tamanho do inventario (linha da lista). */
export type EstacaoComContagem = Workstation & { asset: Asset; _count: { programas: number; portas: number } };

/** Estacao com o ativo e o inventario completo (detalhe). */
export type EstacaoComInventario = Workstation & { asset: Asset; programas: WorkstationSoftware[]; portas: WorkstationPort[] };

export type StatusConexao = 'Online' | 'Offline';

/**
 * Quantos intervalos de coleta sem contato fazem a estacao virar "Offline".
 *
 * O osquery fala com o servidor pelo menos uma vez por intervalo das queries agendadas
 * (OSQUERY_INTERVALO_S: 1 h em producao, 5 min fora dela), porque cada execucao gera um
 * snapshot que o logger envia; a busca da configuracao (--config_refresh) tambem conta.
 * Com 3 intervalos, uma coleta perdida ou atrasada (splay de 10%, --logger_tls_period,
 * rede instavel) nao derruba o status; tres seguidas, sim. Janela: 3 h em producao e
 * 15 min fora dela. O status e calculado na leitura, nada e gravado.
 */
export const CICLOS_ATE_OFFLINE = 3;

/** Id gerado pelo Prisma (cuid): "c" seguido de 24 letras minusculas ou digitos. */
export const PARAMETRO_ID = [regra('id', z.string().regex(/^c[a-z0-9]{24}$/), 'Identificador da estação inválido', 'ID_INVALIDO')];
