import { consultarHash, virusTotalConfigurado } from '../config/virustotal.js';
import {
  COTA_POR_DIA_PADRAO, COTA_POR_MINUTO_PADRAO, VALIDADE_CACHE_HORAS_PADRAO, inteiroDoAmbiente, vereditoDe,
  type SegundaOpiniaoGravada, type SituacaoSegundaOpiniao,
} from '../models/segundaOpiniao.model.js';
import * as repo from '../repositories/segundaOpiniao.repository.js';

// Segunda opiniao do VirusTotal (B20). Regra, nesta ordem:
//  1. sem VIRUSTOTAL_API_KEY: DESLIGADO (a analise segue como no B04);
//  2. cache: o mesmo SHA-256 respondido pelo VirusTotal dentro da validade e reaproveitado;
//  3. cota (4/min e 500/dia por padrao), contada no banco: estourou, INDISPONIVEL (COTA) sem consultar;
//  4. consulta so pelo hash; qualquer falha vira INDISPONIVEL.
// Nunca lanca: a segunda opiniao nao pode derrubar a analise do ClamAV.

const UM_MINUTO_MS = 60 * 1000;
const UM_DIA_MS = 24 * 60 * 60 * 1000;

const indisponivel = (motivo: SegundaOpiniaoGravada['vtMotivo']): SegundaOpiniaoGravada =>
  ({ vtSituacao: 'INDISPONIVEL', vtMotivo: motivo, vtDeteccoes: null, vtTotal: null, vtConsultadoEm: null });

/** Reserva uma consulta na cota; false se o minuto ou o dia ja estao cheios. */
async function cabeNaCota(agora: number): Promise<boolean> {
  await repo.apagarConsultasAntigas(new Date(agora - UM_DIA_MS));
  const { id, noMinuto, noDia } = await repo.reservarConsulta(new Date(agora - UM_MINUTO_MS), new Date(agora - UM_DIA_MS));
  if (noMinuto <= inteiroDoAmbiente('VIRUSTOTAL_COTA_MINUTO', COTA_POR_MINUTO_PADRAO)
    && noDia <= inteiroDoAmbiente('VIRUSTOTAL_COTA_DIA', COTA_POR_DIA_PADRAO)) return true;
  await repo.cancelarReserva(id);
  return false;
}

/** Segunda opiniao para o SHA-256 dado, pronta para gravar no FileScan. */
export async function obter(sha256: string): Promise<SegundaOpiniaoGravada> {
  if (!virusTotalConfigurado())
    return { vtSituacao: 'DESLIGADO', vtMotivo: null, vtDeteccoes: null, vtTotal: null, vtConsultadoEm: null };
  try {
    const agora = Date.now();
    const validadeMs = inteiroDoAmbiente('VIRUSTOTAL_CACHE_HORAS', VALIDADE_CACHE_HORAS_PADRAO) * 60 * 60 * 1000;
    const guardado = await repo.buscarEmCache(sha256, new Date(agora - validadeMs));
    if (guardado) {
      return {
        vtSituacao: guardado.vtSituacao as SituacaoSegundaOpiniao,
        vtMotivo: null,
        vtDeteccoes: guardado.vtDeteccoes,
        vtTotal: guardado.vtTotal,
        vtConsultadoEm: guardado.vtConsultadoEm,
      };
    }
    if (!(await cabeNaCota(agora))) return indisponivel('COTA');

    const resposta = await consultarHash(sha256);
    if (resposta.tipo === 'INDISPONIVEL') return indisponivel(resposta.motivo);
    const consultadoEm = new Date();
    if (resposta.tipo === 'DESCONHECIDO')
      return { vtSituacao: 'DESCONHECIDO', vtMotivo: null, vtDeteccoes: null, vtTotal: null, vtConsultadoEm: consultadoEm };
    return { ...vereditoDe(resposta.estatisticas), vtMotivo: null, vtConsultadoEm: consultadoEm };
  } catch (e) {
    // Falha do banco no cache ou na cota: a analise segue sem a segunda opiniao.
    console.error('[virustotal] falha no cache/cota:', e instanceof Error ? e.message : e);
    return indisponivel('FALHA');
  }
}
