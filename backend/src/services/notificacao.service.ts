import type { PrefCampo } from '../models/notificacao.model.js';
import * as repo from '../repositories/notificacao.repository.js';

// Preferencias de notificacao por e-mail (uma linha por usuario, criada sob demanda).

function mapPreferencias(p: Record<PrefCampo, boolean> & { atualizadoEm: Date }) {
  return {
    alertasEmail: p.alertasEmail,
    somenteCriticas: p.somenteCriticas,
    resumoSemanal: p.resumoSemanal,
    relatoriosCampanha: p.relatoriosCampanha,
    atualizadoEm: p.atualizadoEm,
  };
}

/** Leitura nao toca em `atualizadoEm`: cria com os padroes so na primeira vez. */
export async function ler(userId: string) {
  return mapPreferencias((await repo.buscar(userId)) ?? (await repo.criarPadrao(userId)));
}

export async function salvar(userId: string, dados: Partial<Record<PrefCampo, boolean>>) {
  return mapPreferencias(await repo.salvar(userId, dados));
}
