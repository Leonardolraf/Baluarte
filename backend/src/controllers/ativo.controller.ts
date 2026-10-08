import type { Request, Response } from 'express';
import { usuarioDe } from '../middlewares/auth.middleware.js';
import { CADASTRO } from '../models/ativo.model.js';
import * as ativoService from '../services/ativo.service.js';
import { enviar } from '../utils/resposta.js';
import { validar } from '../utils/esquemas.js';
import { normalizarHost } from '../utils/validacao.js';

// Controller de ativos.

/** Texto opcional ja validado: vazio/ausente vira null; o resto, trim. */
function opcionalOuNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * POST /assets (contrato N2 AT1; Administrador/Analista). Extensoes compativeis (B10): o
 * host aceita endereco com http(s):// (guarda so o host) e `ip`/`descricao` opcionais.
 */
export async function cadastrar(req: Request, res: Response) {
  const corpo = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const { nome, tipo, host, ip, descricao } = validar({ ...corpo, host: normalizarHost(corpo.host) }, CADASTRO);
  const dados = await ativoService.cadastrar(usuarioDe(req).id, {
    nome: nome as string,
    tipo: tipo as string,
    host: String(host).trim(),
    ip: opcionalOuNull(ip),
    descricao: opcionalOuNull(descricao),
  });
  return enviar(res, 201, { status: 'sucesso', mensagem: 'Ativo cadastrado com sucesso', dados });
}

/** GET /assets (Administrador/Analista). */
export async function listar(_req: Request, res: Response) {
  enviar(res, 200, { status: 'sucesso', dados: await ativoService.listar() });
}
