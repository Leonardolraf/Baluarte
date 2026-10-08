import * as repo from './repository.js';

// Preferencias de notificacao por e-mail (uma linha por usuario, criada sob demanda).

export const PREF_CAMPOS = ['alertasEmail', 'somenteCriticas', 'resumoSemanal', 'relatoriosCampanha'] as const;
export type PrefCampo = (typeof PREF_CAMPOS)[number];

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
