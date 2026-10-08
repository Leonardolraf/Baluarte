import { falhar } from '../utils/resposta.js';
import { localizarPorEmail } from '../repositories/usuario.repository.js';
import * as repo from '../repositories/auditoria.repository.js';
import {
  LOTE_VERIFICACAO,
  RETENCAO_MESES,
  type FiltrosAuditoria,
  type MotivoQuebra,
  type RegistroAuditoriaDto,
  type ResultadoIntegridade,
  type ResultadoRetencao,
} from '../models/auditoria.model.js';

// Trilha de auditoria (tabela AuditLog): registra as acoes sensiveis das rotas de
// escrita. Nunca derruba a requisicao — uma falha aqui vira apenas log de erro.
export async function registrarAuditoria(
  usuarioId: string | null,
  acao: string,
  detalhe?: string,
): Promise<void> {
  try {
    await repo.criarRegistro(usuarioId, acao, detalhe ?? null);
  } catch (e) {
    console.error('[auditoria] falha ao registrar', acao, e);
  }
}

/**
 * Consulta da trilha (GET /auditoria, so Administrador): filtros por acao, autor (id ou
 * e-mail) e periodo, paginada no servidor, mais recente primeiro. O autor vem do cadastro
 * atual pelos ids; conta excluida (ou registro sem autor) sai com `usuario: null`.
 */
export async function consultar(f: FiltrosAuditoria) {
  if (f.de && f.ate && f.de > f.ate) falhar(400, 'Período inválido: a data inicial é posterior à final', 'PERIODO_INVALIDO');
  const acoes = await repo.acoesDistintas();
  const resumo = (total: number) => ({ total, pagina: f.pagina, tamanho: f.tamanho, acoes });

  let usuarioId = f.usuarioId;
  if (f.email) {
    const dono = await localizarPorEmail(f.email);
    // E-mail sem conta, ou de outra pessoa que o usuarioId pedido: nenhum registro casa.
    if (!dono || (usuarioId && usuarioId !== dono.id)) return { lista: [] as RegistroAuditoriaDto[], resumo: resumo(0) };
    usuarioId = dono.id;
  }

  const { registros, total } = await repo.consultar({ acao: f.acao, usuarioId, de: f.de, ate: f.ate }, f.pagina, f.tamanho);
  const ids = [...new Set(registros.map((r) => r.usuarioId).filter((id): id is string => id !== null))];
  const autores = new Map((ids.length ? await repo.usuariosPorIds(ids) : []).map((u) => [u.id, u]));
  const lista: RegistroAuditoriaDto[] = registros.map((r) => ({
    id: r.id,
    acao: r.acao,
    detalhe: r.detalhe,
    quando: r.timestamp,
    usuario: (r.usuarioId ? autores.get(r.usuarioId) : undefined) ?? null,
  }));
  return { lista, resumo: resumo(total) };
}

/**
 * Verificacao da cadeia de hash (GET /auditoria/integridade, so Administrador). Percorre a
 * trilha na ordem da `sequencia` e para na primeira quebra:
 * - `SEM_HASH`: registro sem hash (nao passou pelo trigger de INSERT);
 * - `CONTEUDO_ALTERADO`: o hash recalculado agora nao bate com o gravado;
 * - `ELO_QUEBRADO`: o `hashAnterior` nao e o hash do registro anterior.
 * O primeiro registro e a ancora: o `hashAnterior` dele e aceito como esta (NULL no inicio da
 * cadeia, ou o hash do ultimo registro apagado pela retencao), sem falso positivo.
 * A verificacao e leitura e nao vai para a trilha: a tela /audit a chama a cada carga e cada
 * consulta viraria um registro novo na propria lista que o administrador esta lendo.
 */
export async function verificarIntegridade(): Promise<ResultadoIntegridade> {
  const travaNoBanco = await repo.travaAtiva();
  let anterior: string | null | undefined; // undefined: ainda nao passou da ancora
  let registrosVerificados = 0;
  for await (const lote of repo.lotesDaCadeia(LOTE_VERIFICACAO)) {
    for (const elo of lote) {
      registrosVerificados += 1;
      let motivo: MotivoQuebra | null = null;
      if (elo.hash === null) motivo = 'SEM_HASH';
      else if (elo.hash !== elo.calculado) motivo = 'CONTEUDO_ALTERADO';
      else if (anterior !== undefined && elo.hashAnterior !== anterior) motivo = 'ELO_QUEBRADO';
      if (motivo)
        return {
          integra: false,
          registrosVerificados,
          travaNoBanco,
          primeiraQuebra: { id: elo.id, timestamp: elo.timestamp, motivo },
        };
      anterior = elo.hash;
    }
  }
  return { integra: true, registrosVerificados, travaNoBanco };
}

/**
 * Politica de retencao (POST /auditoria/retencao, so Administrador; tambem
 * `npm run auditoria:retencao`, para agendar). Apaga os registros com mais de RETENCAO_MESES
 * pela funcao do banco e registra APLICAR_RETENCAO_AUDITORIA com a quantidade, o corte e a
 * ancora (o hash do ultimo apagado, onde a cadeia restante comeca).
 */
export async function aplicarRetencao(usuarioId: string | null): Promise<ResultadoRetencao> {
  const { apagados, corte, ancora } = await repo.aplicarRetencao(RETENCAO_MESES);
  await registrarAuditoria(
    usuarioId,
    'APLICAR_RETENCAO_AUDITORIA',
    `${apagados} registro(s) anteriores a ${corte.toISOString()} apagados (retenção de ${RETENCAO_MESES} meses)` +
      (ancora ? `; âncora ${ancora}` : ''),
  );
  return { apagados, corte, retencaoMeses: RETENCAO_MESES };
}

/**
 * O que a politica de seguranca publica sobre a auditoria. `logImutavel` so e verdadeiro
 * quando a trava do banco esta de fato ativa (migration 20261008176000_auditoria_imutavel).
 */
export async function politicaAuditoria() {
  return { registraAcoes: true, logImutavel: await repo.travaAtiva(), retencaoMeses: RETENCAO_MESES };
}
