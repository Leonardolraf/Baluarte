import type { Request, Response } from 'express';
import { CONFIG, INSCRICAO, LOGGER } from '../models/agente.model.js';
import * as agenteService from '../services/agente.service.js';
import { agora, enviar, ErroNegocio } from '../utils/resposta.js';
import { validar } from '../utils/esquemas.js';

// Controller do agente osquery (B07). As respostas seguem o protocolo remoto do osquery,
// nao o envelope { status, dados } da API: enroll devolve { node_key, node_invalid },
// config devolve a configuracao do osquery e logger devolve {}. Chave desconhecida em
// config/logger responde 200 { node_invalid: true }, que e o que faz o osquery se
// reinscrever (ele nao le o corpo de respostas fora de 2xx). Os erros (corpo invalido,
// segredo errado, inscricao desligada) levam o envelope de erro da API e node_invalid.

async function protocolo(res: Response, fn: () => Promise<{ status: number; corpo: unknown }>) {
  try {
    const { status, corpo } = await fn();
    enviar(res, status, corpo);
  } catch (e) {
    if (!(e instanceof ErroNegocio)) throw e;
    enviar(res, e.status, { node_invalid: true, status: 'erro', mensagem: e.mensagem, codigoErro: e.codigo, timestamp: agora() });
  }
}

const CHAVE_INVALIDA = { status: 200, corpo: { node_invalid: true } };

/** POST /agentes/osquery/enroll (publico; protegido pelo segredo de inscricao). */
export async function inscrever(req: Request, res: Response) {
  await protocolo(res, async () => {
    const corpo = validar(req.body, INSCRICAO);
    const nodeKey = await agenteService.inscrever({
      segredo: corpo.enroll_secret,
      hostIdentifier: String(corpo.host_identifier).trim(),
      hostDetails: corpo.host_details,
    });
    return { status: 200, corpo: { node_key: nodeKey, node_invalid: false } };
  });
}

/** POST /agentes/osquery/config (exige node_key valida). */
export async function configuracao(req: Request, res: Response) {
  await protocolo(res, async () => {
    const { node_key } = validar(req.body, CONFIG);
    const config = await agenteService.configuracaoDaEstacao(node_key as string);
    return config ? { status: 200, corpo: { ...config, node_invalid: false } } : CHAVE_INVALIDA;
  });
}

/** POST /agentes/osquery/logger (exige node_key valida). */
export async function receberLog(req: Request, res: Response) {
  await protocolo(res, async () => {
    const { node_key, log_type, data } = validar(req.body, LOGGER);
    const ok = await agenteService.receberLog(node_key as string, log_type as string, data as unknown[]);
    return ok ? { status: 200, corpo: {} } : CHAVE_INVALIDA;
  });
}
