// Infra compartilhada pelos testes de integracao (node:test + fetch).
//
// Cada arquivo de teste roda no seu proprio processo (`node --test`), entao cada um
// ganha um SQLite PROPRIO (prisma/test-<nome>.db), recriado e semeado no import.
// Isso permite rodar as suites em paralelo sem que uma pise no banco da outra.
//
// Uso, no topo do arquivo de teste (antes de importar a app):
//   import { prepararBanco, iniciarServidor, chamar, login, ... } from './helpers.js';
//   prepararBanco(import.meta.url);
//   const { app } = await import('../src/app.js');
//   before(() => iniciarServidor(app)); after(() => encerrarServidor());
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';

export const SENHA_PROVISORIA = 'Mudar@123';
export const ADMIN = { email: 'admin@empresa.com', senha: 'Admin@123' };
export const ANALISTA = { email: 'analista@empresa.com', senha: 'Senha@123' };

function npx(args: string): void {
  const r = spawnSync(`npx ${args}`, { shell: true, encoding: 'utf8', env: process.env });
  if (r.status !== 0) throw new Error(`falha em "npx ${args}":\n${r.stdout}\n${r.stderr}`);
}

/** Aponta DATABASE_URL para um banco exclusivo deste arquivo de teste e o recria com o seed de contrato. */
export function prepararBanco(testFileUrl: string): void {
  const nome = basename(fileURLToPath(testFileUrl)).replace(/\.test\.ts$/, '');
  process.env.DATABASE_URL = `file:./test-${nome}.db`;
  process.env.JWT_SECRET = 'segredo-somente-para-testes';
  process.env.NODE_ENV = 'test';
  // O canal de entrega do token de redefinicao em dev/demo e o log (opt-in).
  process.env.RESET_TOKEN_CONSOLE = '1';
  process.env.FRONTEND_URL = 'http://localhost:5173';
  npx('prisma db push --force-reset --accept-data-loss --skip-generate');
  npx('tsx prisma/seed.ts');
}

let server: Server | null = null;
let base = '';

/** Sobe a app numa porta efemera; `chamar` passa a apontar para ela. */
export function iniciarServidor(app: Express): Promise<string> {
  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api`;
      resolve(base);
    });
  });
}

export function encerrarServidor(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = null;
  });
}

export function urlBase(): string {
  return base;
}

export type Resposta = { status: number; body: any; headers: Headers };

export interface OpcoesChamada {
  body?: unknown;
  token?: string;
  /** Cabecalhos extras (ex.: Origin, Content-Type diferente). */
  headers?: Record<string, string>;
  /** Corpo bruto (string) — para JSON malformado ou outros tipos de conteudo. */
  raw?: string;
}

export async function chamar(method: string, path: string, opts: OpcoesChamada = {}): Promise<Resposta> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    ...(opts.headers ?? {}),
  };
  const body = opts.raw !== undefined ? opts.raw : opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const res = await fetch(base + path, { method, headers, body });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json, headers: res.headers };
}

export async function login(email: string, senha: string): Promise<string> {
  const r = await chamar('POST', '/login', { body: { email, senha } });
  assert.equal(r.status, 200, `login de ${email} falhou: ${JSON.stringify(r.body)}`);
  return r.body.dados.token as string;
}

export function esperaErro(r: Resposta, status: number, codigo: string): void {
  assert.equal(r.status, status, `esperava ${status} ${codigo}, veio ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.body.status, 'erro');
  assert.equal(r.body.codigoErro, codigo);
}

let seq = 0;
export function emailUnico(prefixo: string): string {
  seq += 1;
  return `${prefixo}.${Date.now()}.${seq}@empresa.com`;
}

/** Cria um usuario pelo contrato (senha provisoria Mudar@123, status Pendente). */
export async function criarUsuario(
  token: string,
  perfil: 'Administrador' | 'Analista' | 'Colaborador',
  prefixo = 'teste',
): Promise<{ id: string; email: string }> {
  const email = emailUnico(prefixo);
  const r = await chamar('POST', '/users', { token, body: { nome: `Usuário ${prefixo}`, email, perfil } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: r.body.dados.idUsuario as string, email };
}
