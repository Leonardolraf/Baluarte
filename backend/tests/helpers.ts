// Infra compartilhada pelos testes de integracao (node:test + fetch).
//
// Cada arquivo de teste roda no seu proprio processo (`node --test`), entao cada um
// ganha um banco Postgres PROPRIO (baluarte_test_<nome>, no mesmo servidor do
// DATABASE_URL do .env ou de TEST_DATABASE_URL), recriado pelas migrations e semeado
// no import. Isso permite rodar as suites em paralelo sem que uma pise na outra.
// Trava: so roda contra servidor local (localhost/127.0.0.1/db), para nunca apagar
// um banco remoto (ex.: o Supabase) por engano.
//
// Uso, no topo do arquivo de teste (antes de importar a app):
//   import { prepararBanco, iniciarServidor, chamar, login, ... } from './helpers.js';
//   prepararBanco(import.meta.url);
//   const { app } = await import('../src/app.js');
//   before(() => iniciarServidor(app)); after(() => encerrarServidor());
import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';

/** Senha que `criarUsuario` cadastra pelo link do convite (nao existe senha provisoria). */
export const SENHA_CONTA = 'Conta@1234';
export const ADMIN = { email: 'admin@empresa.com', senha: 'Admin@123' };
export const ANALISTA = { email: 'analista@empresa.com', senha: 'Senha@123' };

function npx(args: string): void {
  const r = spawnSync(`npx ${args}`, { shell: true, encoding: 'utf8', env: process.env });
  if (r.status !== 0) throw new Error(`falha em "npx ${args}":\n${r.stdout}\n${r.stderr}`);
}

const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '::1', 'db']);

/** Aponta DATABASE_URL para um banco exclusivo deste arquivo de teste e o recria com o seed de contrato. */
export function prepararBanco(testFileUrl: string): void {
  configurarBancoDeTeste(testFileUrl);
  // migrate reset cria o banco se faltar, apaga tudo e reaplica as migrations (testa as migrations de verdade).
  npx('prisma migrate reset --force --skip-seed --skip-generate');
  npx('tsx prisma/seed.ts');
}

/**
 * So aponta o ambiente para o banco exclusivo do arquivo (sem criar nem semear): quem precisa
 * montar o banco de outro jeito (ex.: o teste do backfill de uma migration) usa isto. Devolve a URL.
 */
export function configurarBancoDeTeste(testFileUrl: string): string {
  const nome = basename(fileURLToPath(testFileUrl)).replace(/\.test\.ts$/, '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!base?.startsWith('postgres')) throw new Error('defina DATABASE_URL (ou TEST_DATABASE_URL) apontando para o Postgres local');
  const url = new URL(base);
  if (!HOSTS_LOCAIS.has(url.hostname))
    throw new Error(`os testes recriam bancos: recusando o servidor nao local "${url.hostname}" (use TEST_DATABASE_URL local)`);
  // TEST_DB_PREFIXO separa execucoes simultaneas (ex.: dois worktrees rodando a suite ao mesmo tempo).
  const prefixo = (process.env.TEST_DB_PREFIXO ?? '').replace(/[^a-z0-9_]/gi, '').toLowerCase();
  url.pathname = `/baluarte_test_${prefixo}${nome}`;
  process.env.DATABASE_URL = url.toString();
  process.env.DIRECT_URL = url.toString();
  process.env.JWT_SECRET = 'segredo-somente-para-testes';
  process.env.NODE_ENV = 'test';
  // Com NODE_ENV=test os e-mails vao para a caixa em memoria (src/config/email.ts), nunca para SMTP.
  delete process.env.SMTP_HOST;
  // Nenhum teste consulta o VirusTotal de verdade: quem testa a segunda opiniao (B20) aponta
  // VIRUSTOTAL_API_URL para um servidor local e define uma chave falsa.
  delete process.env.VIRUSTOTAL_API_KEY;
  delete process.env.VIRUSTOTAL_API_URL;
  process.env.FRONTEND_URL = 'http://localhost:5173';
  // B14: nada de rede real nos testes. As bases de vulnerabilidades apontam para uma porta local
  // sem servidor (quem testa o cruzamento sobe um OSV/NVD falso e troca estas URLs); sem chave
  // do NVD; o cruzamento automatico ja fica desligado com NODE_ENV=test.
  process.env.OSV_API_URL = 'http://127.0.0.1:9';
  process.env.NVD_API_URL = 'http://127.0.0.1:9';
  delete process.env.NVD_API_KEY;
  delete process.env.CRUZAMENTO_AUTOMATICO;
  return url.toString();
}

/** Roda `npx <args>` (falha com a saida do comando). */
export function rodarNpx(args: string): void {
  npx(args);
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

type Perfil = 'Administrador' | 'Analista' | 'Colaborador';

/**
 * Token do link mais recente enviado a um e-mail (caixa de saida em memoria). Filtra pela
 * rota do link: 'definir-senha' (convite) ou 'reset-password' (redefinicao).
 */
export async function tokenDoEmail(email: string, rota?: 'definir-senha' | 'reset-password'): Promise<string | null> {
  const { caixaDeSaida } = await import('../src/config/email.js');
  const padrao = new RegExp(`/(${rota ?? 'definir-senha|reset-password'})\\?token=([0-9a-f]{64})`);
  for (let i = caixaDeSaida.length - 1; i >= 0; i--) {
    const m = caixaDeSaida[i].para.toLowerCase() === email.toLowerCase() ? caixaDeSaida[i].texto.match(padrao) : null;
    if (m) return m[2];
  }
  return null;
}

/** Cria um usuario pelo contrato e para no convite: status Pendente, sem senha utilizavel. */
export async function criarUsuarioPendente(
  token: string,
  perfil: Perfil,
  prefixo = 'teste',
): Promise<{ id: string; email: string; convite: string }> {
  const email = emailUnico(prefixo);
  const r = await chamar('POST', '/users', { token, body: { nome: `Usuário ${prefixo}`, email, perfil } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const convite = await tokenDoEmail(email, 'definir-senha');
  assert.ok(convite, `esperava o e-mail de convite para ${email}`);
  return { id: r.body.dados.idUsuario as string, email, convite };
}

/** Cria um usuario pelo contrato e aceita o convite com SENHA_CONTA (status Ativo). */
export async function criarUsuario(token: string, perfil: Perfil, prefixo = 'teste'): Promise<{ id: string; email: string }> {
  const { id, email, convite } = await criarUsuarioPendente(token, perfil, prefixo);
  const r = await chamar('POST', '/auth/reset-password/confirm', { body: { token: convite, novaSenha: SENHA_CONTA } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { id, email };
}

export type Download = { status: number; headers: Headers; corpo: Buffer; body: any };

/** GET de um arquivo (ex.: o relatorio em PDF): corpo em bytes; em erro, o envelope JSON em `body`. */
export async function baixar(path: string, token?: string): Promise<Download> {
  const res = await fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const corpo = Buffer.from(await res.arrayBuffer());
  let body: any = {};
  if ((res.headers.get('content-type') ?? '').includes('application/json')) body = JSON.parse(corpo.toString('utf8'));
  return { status: res.status, headers: res.headers, corpo, body };
}
