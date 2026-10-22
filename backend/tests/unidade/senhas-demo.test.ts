// Testes de UNIDADE do DT32 (senhas da demonstração), sem banco:
//  - guarda: nenhum `hash('<literal>')` em backend/prisma/ fora do seed de contrato (seed.ts, cujas
//    3 senhas do README o Newman e o Robot usam). Foi assim que a senha pública do seed:demo nasceu;
//  - o caminho do arquivo de senhas: padrão fora do repositório, recusa dentro dele (inclusive
//    relativo, com maiúsculas trocadas no Windows e com o backend fora de um checkout git, como /app
//    no Docker);
//  - geração, formato e gravação atômica com permissão restrita.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import {
  PASTA_BACKEND,
  caminhoPadrao,
  estaDentro,
  gerarSenha,
  lerSenhas,
  montarConteudo,
  prepararGravacao,
  raizDoRepositorio,
  resolverArquivoSenhas,
} from '../../prisma/arquivoSenhasDemo.js';

const PASTA_PRISMA = join(PASTA_BACKEND, 'prisma');
const EXTENSOES = /\.(ts|mts|cts|js|mjs|cjs)$/;

/** Trechos `hash('...')`/`hash("...")`/hash(`...`) (bcrypt.hash, hashSync ou hash importado) no fonte. */
function literaisDeHash(fonte: string): string[] {
  return [...fonte.matchAll(/\bhash(?:Sync)?\s*\(\s*['"`][^'"`]*['"`]?/g)].map((m) => m[0]);
}

function arquivosDoPrisma(pasta: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, nome.name);
    if (nome.isDirectory()) saida.push(...arquivosDoPrisma(caminho));
    else if (EXTENSOES.test(nome.name)) saida.push(caminho);
  }
  return saida;
}

describe('guarda do DT32: senha literal com hash em backend/prisma/', () => {
  it('o detector pega as formas comuns (controle negativo) e ignora hash de variável', () => {
    assert.equal(literaisDeHash("await bcrypt.hash('Mudar@123', 10)").length, 1);
    assert.equal(literaisDeHash('bcrypt.hash("x", 10)').length, 1);
    assert.equal(literaisDeHash('bcrypt.hashSync( `y`, 10)').length, 1);
    assert.equal(literaisDeHash("import { hash } from 'bcryptjs'; await hash('z', 10)").length, 1);
    assert.equal(literaisDeHash('await bcrypt.hash(senhaDe.get(email)!, 10)').length, 0);
    assert.equal(literaisDeHash("hashToken('abc')").length, 0);
  });

  it('nenhum arquivo de backend/prisma/ fora do seed.ts faz hash de string literal', () => {
    const arquivos = arquivosDoPrisma(PASTA_PRISMA);
    assert.ok(arquivos.some((a) => a.endsWith('seed-demo.ts')), 'a varredura precisa enxergar o seed-demo.ts');
    const achados = arquivos
      .filter((a) => relative(PASTA_PRISMA, a) !== 'seed.ts')
      .flatMap((a) => literaisDeHash(readFileSync(a, 'utf8')).map((trecho) => `${relative(PASTA_BACKEND, a)}: ${trecho}`));
    assert.deepEqual(achados, [], 'senha de conta nunca é literal fora do seed de contrato (DT32)');
  });
});

describe('arquivo de senhas da demonstração: caminho (DT32)', () => {
  const raiz = raizDoRepositorio();

  it('a raiz do repositório contém o backend', () => {
    assert.ok(estaDentro(PASTA_BACKEND, raiz));
    assert.ok(existsSync(join(raiz, '.git')) || resolve(PASTA_BACKEND, '..') === raiz);
  });

  it('sem SENHAS_DEMO_ARQUIVO, o padrão é ~/.baluarte/senhas-demo.txt', () => {
    assert.equal(caminhoPadrao(), join(homedir(), '.baluarte', 'senhas-demo.txt'));
    // A máquina de quem roda pode ter o repositório dentro do home, mas não o home dentro do repositório.
    if (!estaDentro(caminhoPadrao(), raiz)) assert.equal(resolverArquivoSenhas({}), caminhoPadrao());
  });

  it('caminho fora do repositório é aceito e sai absoluto', () => {
    const fora = join(tmpdir(), 'baluarte-dt32-fora', 'senhas.txt');
    assert.equal(resolverArquivoSenhas({ SENHAS_DEMO_ARQUIVO: fora }), fora);
  });

  it('caminho dentro do repositório é recusado: backend, raiz, .git e relativo', () => {
    const dentro = [
      join(PASTA_BACKEND, 'senhas-demo.txt'),
      join(raiz, 'senhas-demo.txt'),
      join(raiz, '.git', 'senhas-demo.txt'),
      join(raiz, 'pasta', 'que', 'nao', 'existe', 'senhas.txt'),
      relative(process.cwd(), join(raiz, 'senhas.txt')),
    ];
    for (const caminho of dentro)
      assert.throws(() => resolverArquivoSenhas({ SENHAS_DEMO_ARQUIVO: caminho }), /dentro do repositório/, caminho);
  });

  it('no Windows, maiúsculas trocadas não escapam da recusa', { skip: process.platform !== 'win32' }, () => {
    assert.throws(() => resolverArquivoSenhas({ SENHAS_DEMO_ARQUIVO: join(raiz, 'senhas.txt').toUpperCase() }), /dentro do repositório/);
  });

  it('pasta existente é recusada', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'baluarte-dt32-pasta-'));
    try {
      assert.throws(() => resolverArquivoSenhas({ SENHAS_DEMO_ARQUIVO: pasta }), /pasta/);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it('backend fora de checkout git (imagem Docker em /app): a raiz é o próprio backend e /data fica fora', () => {
    const app = resolve('/app-baluarte-dt32-inexistente');
    assert.equal(raizDoRepositorio(app), app);
    assert.equal(estaDentro(resolve('/data/senhas-demo.txt'), raizDoRepositorio(app)), false);
    assert.ok(estaDentro(join(app, 'senhas.txt'), raizDoRepositorio(app)));
  });

  it('checkout sem .git (zip): a raiz é backend/..', () => {
    const base = mkdtempSync(join(tmpdir(), 'baluarte-dt32-zip-'));
    try {
      const backend = join(base, 'Baluarte', 'backend');
      assert.equal(raizDoRepositorio(backend), join(base, 'Baluarte'));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('arquivo de senhas da demonstração: conteúdo e gravação (DT32)', () => {
  const pastas: string[] = [];
  after(() => { for (const p of pastas) rmSync(p, { recursive: true, force: true }); });
  const novaPasta = () => {
    const p = mkdtempSync(join(tmpdir(), 'baluarte-dt32-grava-'));
    pastas.push(p);
    return p;
  };

  it('senha: 24 caracteres base64url (144 bits de randomBytes), sem repetição', () => {
    const senhas = Array.from({ length: 200 }, gerarSenha);
    for (const s of senhas) assert.match(s, /^[A-Za-z0-9_-]{24}$/);
    assert.equal(new Set(senhas).size, senhas.length);
  });

  it('conteúdo: cabeçalho com escopo honesto e linha e-mail/perfil/senha, lido de volta', () => {
    const contas = [
      { email: 'edson@empresa.com', perfil: 'Analista', senha: 'aaa' },
      { email: 'ana.souza@empresa.com', perfil: 'Colaborador', senha: 'bbb' },
    ];
    const texto = montarConteudo(contas, new Date('2026-10-19T12:00:00Z'));
    assert.match(texto, /não é publicada no repositório/);
    assert.match(texto, /não copie este arquivo junto com dumps ou backups/);
    assert.doesNotMatch(texto, /secret/i);
    assert.match(texto, /^edson@empresa\.com\tAnalista\taaa$/m);
    assert.deepEqual([...lerSenhas(texto)], [['edson@empresa.com', 'aaa'], ['ana.souza@empresa.com', 'bbb']]);
    assert.deepEqual([...lerSenhas(texto.replace(/\n/g, '\r\n'))].length, 2);
  });

  it('gravação: nada no destino antes de confirmar; depois, arquivo com permissão restrita e sem temporário', () => {
    const pasta = novaPasta();
    const destino = join(pasta, 'sub', 'senhas-demo.txt');
    const g = prepararGravacao(destino, 'conteudo-1\n');
    assert.equal(existsSync(destino), false);
    g.confirmar();
    assert.equal(readFileSync(destino, 'utf8'), 'conteudo-1\n');
    assert.deepEqual(readdirSync(join(pasta, 'sub')), ['senhas-demo.txt']);
    if (process.platform === 'win32') {
      assert.equal(g.avisoPermissao, false, 'o icacls deveria ter restringido o arquivo');
      const acl = spawnSync('icacls', [destino], { encoding: 'utf8' }).stdout;
      assert.doesNotMatch(acl, /\(I\)/, `sem permissão herdada:\n${acl}`);
      assert.doesNotMatch(acl, /Everyone|Todos|BUILTIN\\Users|BUILTIN\\Usu/i, acl);
    } else {
      assert.equal(statSync(destino).mode & 0o777, 0o600);
    }
  });

  it('gravação: substitui o arquivo anterior por inteiro; descartar não deixa resto', () => {
    const pasta = novaPasta();
    const destino = join(pasta, 'senhas-demo.txt');
    writeFileSync(destino, 'antigo\n');
    prepararGravacao(destino, 'novo\n').confirmar();
    assert.equal(readFileSync(destino, 'utf8'), 'novo\n');
    prepararGravacao(destino, 'descartado\n').descartar();
    assert.equal(readFileSync(destino, 'utf8'), 'novo\n');
    assert.deepEqual(readdirSync(pasta), ['senhas-demo.txt']);
  });
});
