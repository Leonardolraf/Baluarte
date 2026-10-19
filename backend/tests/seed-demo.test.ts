// O seed:demo (prisma/seed-demo.ts) de verdade, num banco próprio (DT32). Antes, todas as contas
// de demonstração nasciam com uma senha fixa publicada no repositório. Confere:
//  - o arquivo de senhas é gerado no caminho de SENHAS_DEMO_ARQUIVO, com uma senha por conta;
//  - as senhas do arquivo batem com o hash do banco (bcrypt.compare) e entram no login da API;
//  - duas execuções geram senhas diferentes (e a anterior deixa de valer);
//  - caminho dentro do repositório é recusado ANTES de apagar qualquer dado;
//  - nenhuma senha aparece na saída do seed (stdout + stderr capturados).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { chamar, encerrarServidor, iniciarServidor, prepararBanco } from './helpers.js';
import { PASTA_BACKEND, lerSenhas } from '../prisma/arquivoSenhasDemo.js';

prepararBanco(import.meta.url);
const { prisma } = await import('../src/config/db.js');
const { app } = await import('../src/app.js');

const pasta = mkdtempSync(join(tmpdir(), 'baluarte-dt32-seed-'));
const ARQUIVO = join(pasta, 'senhas-demo.txt');
const NOMEADAS = ['edson@empresa.com', 'ana.souza@empresa.com', 'bruno.lima@empresa.com', 'carla.dias@empresa.com'];
const TOTAL_CONTAS = NOMEADAS.length + 203;

before(() => iniciarServidor(app));
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
  rmSync(pasta, { recursive: true, force: true }); // o arquivo de senhas gerado pelo teste não fica
});

interface Execucao { status: number | null; saida: string }

function rodarSeedDemo(arquivo: string): Execucao {
  const r = spawnSync('npx tsx prisma/seed-demo.ts', {
    shell: true,
    encoding: 'utf8',
    cwd: PASTA_BACKEND,
    env: { ...process.env, SENHAS_DEMO_ARQUIVO: arquivo },
  });
  return { status: r.status, saida: `${r.stdout}\n${r.stderr}` };
}

function semSenhaNaSaida(saida: string, senhas: Map<string, string>): void {
  for (const [email, senha] of senhas) assert.ok(!saida.includes(senha), `a senha de ${email} apareceu na saída do seed`);
}

describe('seed:demo grava senhas aleatórias fora do repositório (DT32)', () => {
  let primeira = new Map<string, string>();

  it('gera o arquivo com uma senha por conta, só o caminho no log', () => {
    const r = rodarSeedDemo(ARQUIVO);
    assert.equal(r.status, 0, r.saida);
    assert.ok(existsSync(ARQUIVO));
    assert.deepEqual(readdirSync(pasta), ['senhas-demo.txt'], 'sem temporário sobrando');
    if (process.platform !== 'win32') assert.equal(statSync(ARQUIVO).mode & 0o777, 0o600);

    primeira = lerSenhas(readFileSync(ARQUIVO, 'utf8'));
    assert.equal(primeira.size, TOTAL_CONTAS);
    for (const email of NOMEADAS) assert.ok(primeira.has(email), email);
    assert.equal(new Set(primeira.values()).size, TOTAL_CONTAS, 'uma senha diferente por conta');
    for (const senha of primeira.values()) assert.match(senha, /^[A-Za-z0-9_-]{24}$/);

    assert.ok(r.saida.includes(`senhas da demonstração gravadas em ${ARQUIVO}`), r.saida);
    semSenhaNaSaida(r.saida, primeira);
    assert.doesNotMatch(r.saida, /Mudar@123/);
  });

  it('as senhas do arquivo batem com o hash do banco e entram no login', async () => {
    const amostra = [...NOMEADAS, 'colab0@empresa.com', 'colab101@empresa.com', 'colab202@empresa.com'];
    for (const email of amostra) {
      const u = await prisma.user.findUniqueOrThrow({ where: { email } });
      assert.ok(await bcrypt.compare(primeira.get(email)!, u.senhaHash), email);
      assert.equal(await bcrypt.compare('Mudar@123', u.senhaHash), false, `${email} não aceita a senha antiga`);
    }
    // contas de demonstração não compartilham hash
    const hashes = await prisma.user.findMany({ where: { email: { in: amostra } }, select: { senhaHash: true } });
    assert.equal(new Set(hashes.map((h) => h.senhaHash)).size, amostra.length);

    const ok = await chamar('POST', '/login', { body: { email: 'edson@empresa.com', senha: primeira.get('edson@empresa.com') } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.dados.perfil, 'Analista');
    const antiga = await chamar('POST', '/login', { body: { email: 'ana.souza@empresa.com', senha: 'Mudar@123' } });
    assert.equal(antiga.status, 401);
  });

  it('a segunda execução gera senhas novas para todas as contas e a anterior deixa de valer', async () => {
    const r = rodarSeedDemo(ARQUIVO);
    assert.equal(r.status, 0, r.saida);
    const segunda = lerSenhas(readFileSync(ARQUIVO, 'utf8'));
    assert.equal(segunda.size, TOTAL_CONTAS);
    for (const [email, senha] of segunda) assert.notEqual(senha, primeira.get(email), email);
    semSenhaNaSaida(r.saida, segunda);
    semSenhaNaSaida(r.saida, primeira);

    const edson = await prisma.user.findUniqueOrThrow({ where: { email: 'edson@empresa.com' } });
    assert.ok(await bcrypt.compare(segunda.get('edson@empresa.com')!, edson.senhaHash));
    assert.equal(await bcrypt.compare(primeira.get('edson@empresa.com')!, edson.senhaHash), false);
    primeira = segunda;
  });

  it('caminho dentro do repositório é recusado antes de apagar qualquer dado', async () => {
    const antes = { usuarios: await prisma.user.count(), achados: await prisma.finding.count(), campanhas: await prisma.campaign.count() };
    const hashAntes = (await prisma.user.findUniqueOrThrow({ where: { email: 'edson@empresa.com' } })).senhaHash;
    for (const dentro of [join(PASTA_BACKEND, 'senhas-demo.txt'), join(PASTA_BACKEND, '..', 'senhas-demo.txt'), 'senhas-demo.txt']) {
      const r = rodarSeedDemo(dentro);
      assert.notEqual(r.status, 0, `deveria recusar ${dentro}`);
      assert.match(r.saida, /dentro do repositório/);
      assert.equal(existsSync(join(PASTA_BACKEND, 'senhas-demo.txt')), false);
      assert.equal(existsSync(join(PASTA_BACKEND, '..', 'senhas-demo.txt')), false);
    }
    assert.deepEqual(
      { usuarios: await prisma.user.count(), achados: await prisma.finding.count(), campanhas: await prisma.campaign.count() },
      antes,
    );
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { email: 'edson@empresa.com' } })).senhaHash, hashAntes);
    // o arquivo bom continua o da última execução que deu certo
    assert.deepEqual(lerSenhas(readFileSync(ARQUIVO, 'utf8')), primeira);
  });
});
