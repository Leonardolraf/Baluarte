import { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { TIPO_ESTACAO } from '../models/dominio.model.js';
import { gerarTokenLink, hashToken } from '../utils/tokens.js';
import type { SistemaOperacional } from '../models/agente.model.js';

// Acesso ao banco do vinculo de inscricao da estacao (#9). O unico lugar que fala com o Prisma
// para o StationEnrollmentBinding. O consumo (no enroll) e atomico: trava a linha pendente,
// le o relogio DEPOIS da trava (DT10), cria/reinscreve a estacao e marca o codigo como usado,
// tudo numa transacao — uso unico garantido mesmo sob inscricoes concorrentes.

export function criar(dados: {
  codigoHash: string;
  nome: string;
  host: string | null;
  ip: string | null;
  descricao: string | null;
  usuarioId: string | null;
  criadoPorId: string;
  expiraEm: Date;
}) {
  return prisma.stationEnrollmentBinding.create({ data: dados });
}

/** Pagina de vinculos, mais recente primeiro, com o total do filtro (sem codigo nem hash). */
export async function listar(pagina: number, tamanho: number) {
  const [linhas, total] = await Promise.all([
    prisma.stationEnrollmentBinding.findMany({
      orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      skip: (pagina - 1) * tamanho,
      take: tamanho,
    }),
    prisma.stationEnrollmentBinding.count(),
  ]);
  return { linhas, total };
}

/** Existe usuario com este id (para validar o responsavel informado na emissao). */
export async function usuarioExiste(id: string): Promise<boolean> {
  return (await prisma.user.count({ where: { id } })) > 0;
}

export type ResultadoRevogar = 'ok' | 'nao_encontrado' | 'ja_consumido';

/** Revoga um vinculo pendente (marca consumido sem assetId: queima o codigo, sem apagar a linha). */
export async function revogar(id: string): Promise<ResultadoRevogar> {
  const v = await prisma.stationEnrollmentBinding.findUnique({ where: { id } });
  if (!v) return 'nao_encontrado';
  if (v.consumidoEm) return 'ja_consumido';
  await prisma.stationEnrollmentBinding.update({ where: { id }, data: { consumidoEm: new Date() } });
  return 'ok';
}

/** Host do ativo da estacao: o preferido, senao o hostname, sem colidir com um ativo ja cadastrado. */
async function hostLivreTx(tx: Prisma.TransactionClient, base: string, hostIdentifier: string): Promise<string> {
  const limpo = base.trim().toLowerCase().slice(0, 200) || 'estacao';
  const candidatos = [limpo, `${limpo}-${hashToken(hostIdentifier).slice(0, 8)}`];
  for (const c of candidatos) if ((await tx.asset.count({ where: { host: c } })) === 0) return c;
  return `${limpo}-${gerarTokenLink().slice(0, 12)}`;
}

type PendenteRaw = {
  id: string;
  nome: string;
  host: string | null;
  ip: string | null;
  descricao: string | null;
  usuarioId: string | null;
  expiraEm: Date;
  consumidoEm: Date | null;
};

/**
 * Consome o codigo (uso unico) e cria ou reinscreve a estacao, vinculada aos metadados da emissao.
 * Devolve o assetId em sucesso; null quando o codigo e desconhecido, ja foi usado ou expirou
 * (nos tres casos o enroll responde 401 SEGREDO_INVALIDO — sem distinguir, evita enumeracao).
 */
export async function consumir(dados: {
  hash: string;
  hostIdentifier: string;
  nodeKeyHash: string;
  so: SistemaOperacional;
  hostname: string;
}): Promise<{ assetId: string } | null> {
  return prisma.$transaction(async (tx) => {
    const linhas = await tx.$queryRaw<PendenteRaw[]>`
      SELECT "id", "nome", "host", "ip", "descricao", "usuarioId", "expiraEm", "consumidoEm"
      FROM "StationEnrollmentBinding"
      WHERE "codigoHash" = ${dados.hash}
      FOR UPDATE
    `;
    const pend = linhas[0];
    if (!pend || pend.consumidoEm) return null; // desconhecido ou ja usado
    const agora = new Date(); // relogio DEPOIS da trava (DT10: nunca antes, nunca now() do banco)
    if (pend.expiraEm <= agora) return null; // expirado

    const existente = await tx.workstation.findUnique({ where: { hostIdentifier: dados.hostIdentifier } });
    let assetId: string;
    if (existente) {
      // Reinscricao com codigo fresco: aplica os metadados da emissao a estacao existente; o host
      // (chave unica da maquina) nao muda. ip/descricao/responsavel so quando a emissao os trouxe.
      await tx.workstation.update({
        where: { id: existente.id },
        data: {
          nodeKeyHash: dados.nodeKeyHash,
          ...dados.so,
          vistaEm: agora,
          ...(pend.usuarioId ? { responsavelId: pend.usuarioId } : {}),
        },
      });
      await tx.asset.update({
        where: { id: existente.assetId },
        data: {
          nome: pend.nome,
          ...(pend.ip ? { ip: pend.ip } : {}),
          ...(pend.descricao ? { descricao: pend.descricao } : {}),
        },
      });
      assetId = existente.assetId;
    } else {
      const host = await hostLivreTx(tx, pend.host ?? dados.hostname, dados.hostIdentifier);
      const est = await tx.workstation.create({
        data: {
          hostIdentifier: dados.hostIdentifier,
          nodeKeyHash: dados.nodeKeyHash,
          ...dados.so,
          responsavelId: pend.usuarioId,
          asset: {
            create: { nome: pend.nome, host, tipo: TIPO_ESTACAO, status: 'Ativo', ip: pend.ip, descricao: pend.descricao },
          },
        },
      });
      assetId = est.assetId;
    }
    await tx.stationEnrollmentBinding.update({ where: { id: pend.id }, data: { consumidoEm: agora, assetId } });
    return { assetId };
  });
}
