// Senhas das contas de demonstração (DT32). Antes, o seed:demo usava UMA senha fixa, publicada
// no repositório, para todas as contas. Agora cada execução gera uma senha aleatória por conta
// (crypto.randomBytes) e grava num arquivo FORA da árvore do repositório, como o JWT_SECRET do
// entrypoint: nada de segredo fixo no código nem na imagem.
//
// Escopo honesto: a senha não é publicada no repositório. Quem tem acesso à máquina (ou ao
// volume /data no Docker) lê o arquivo e entra nas contas de demonstração.
//
// Caminho: SENHAS_DEMO_ARQUIVO; sem ela, ~/.baluarte/senhas-demo.txt. No Docker, o entrypoint e
// o Dockerfile passam /data/senhas-demo.txt (volume backend-data, ao lado do jwt.secret).
// O seed RECUSA um caminho dentro do repositório (sairia num `git add -A` ou numa imagem).
//
// Permissão: chmod 600 (dono lê e escreve). No Windows o modo POSIX não vale: o arquivo
// temporário tem a herança de permissões removida e acesso total só para o usuário atual
// (icacls); se o icacls falhar, o arquivo fica com as permissões herdadas da pasta (no padrão,
// ~ = C:\Users\<usuário>, que já é só do usuário, do SYSTEM e dos administradores) e o seed avisa.
// Gravação atômica: arquivo temporário na mesma pasta + rename.
//
// Nenhuma senha vai para stdout, stderr, AuditLog ou mensagem de exceção: este módulo só
// imprime o CAMINHO do arquivo.
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Pasta `backend/` (este arquivo fica em backend/prisma/). */
export const PASTA_BACKEND = resolve(import.meta.dirname, '..');

/** Padrão fora do Docker: ~/.baluarte/senhas-demo.txt. */
export function caminhoPadrao(): string {
  return join(homedir(), '.baluarte', 'senhas-demo.txt');
}

/**
 * Raiz do repositório: sobe a partir de `backend/` até achar `.git` (pasta, ou arquivo num
 * worktree). Sem `.git` (zip, imagem Docker), usa `backend/..`; se esse pai for a raiz do disco
 * (no Docker o backend é /app e o pai é /), usa a própria pasta do backend, senão qualquer
 * caminho do disco contaria como "dentro do repositório".
 */
export function raizDoRepositorio(pastaBackend = PASTA_BACKEND): string {
  const inicio = resolve(pastaBackend);
  for (let dir = inicio; ; ) {
    if (existsSync(join(dir, '.git'))) return dir;
    const pai = dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  const pai = dirname(inicio);
  return dirname(pai) === pai ? inicio : pai;
}

/** Caminho real (links resolvidos) mesmo que o fim ainda não exista: resolve o maior ancestral existente. */
function caminhoReal(p: string): string {
  const absoluto = resolve(p);
  const resto: string[] = [];
  let atual = absoluto;
  while (!existsSync(atual)) {
    const pai = dirname(atual);
    if (pai === atual) return absoluto;
    resto.unshift(basename(atual));
    atual = pai;
  }
  return join(realpathSync.native(atual), ...resto);
}

/** `alvo` está dentro de `raiz` (ou é a própria raiz)? Sem diferenciar maiúsculas no Windows. */
export function estaDentro(alvo: string, raiz: string): boolean {
  const normalizar = (p: string) => (process.platform === 'win32' ? caminhoReal(p).toLowerCase() : caminhoReal(p));
  const rel = relative(normalizar(raiz), normalizar(alvo));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Caminho absoluto do arquivo de senhas (SENHAS_DEMO_ARQUIVO ou o padrão). Lança se ficar dentro
 * do repositório ou se for uma pasta. A mensagem só traz caminhos.
 */
export function resolverArquivoSenhas(env: NodeJS.ProcessEnv = process.env, pastaBackend = PASTA_BACKEND): string {
  const bruto = env.SENHAS_DEMO_ARQUIVO?.trim();
  const alvo = resolve(bruto || caminhoPadrao());
  const raiz = raizDoRepositorio(pastaBackend);
  if (estaDentro(alvo, raiz))
    throw new Error(
      `SENHAS_DEMO_ARQUIVO aponta para dentro do repositório (${alvo}, raiz ${raiz}). ` +
        'As senhas da demonstração não podem ficar na árvore do repositório; use um caminho fora dela ' +
        '(padrão: ~/.baluarte/senhas-demo.txt; no Docker: /data/senhas-demo.txt).',
    );
  if (existsSync(alvo) && statSync(alvo).isDirectory()) throw new Error(`SENHAS_DEMO_ARQUIVO aponta para uma pasta (${alvo})`);
  return alvo;
}

/** Senha forte: 18 bytes de crypto.randomBytes em base64url (24 caracteres, 144 bits). */
export function gerarSenha(): string {
  return randomBytes(18).toString('base64url');
}

export interface ContaDemo {
  email: string;
  perfil: string;
  senha: string;
}

/** Conteúdo do arquivo: cabeçalho com `#` e uma linha `e-mail<TAB>perfil<TAB>senha` por conta. */
export function montarConteudo(contas: ContaDemo[], geradoEm = new Date()): string {
  const cabecalho = [
    `# Baluarte: senhas das contas de demonstração (seed:demo), geradas em ${geradoEm.toISOString()}.`,
    '# Cada execução do seed:demo gera senhas novas e substitui este arquivo.',
    '# A senha não é publicada no repositório, mas quem lê este arquivo entra nessas contas:',
    '# não copie este arquivo junto com dumps ou backups do banco.',
    '# e-mail\tperfil\tsenha',
  ];
  return `${[...cabecalho, ...contas.map((c) => `${c.email}\t${c.perfil}\t${c.senha}`)].join('\n')}\n`;
}

/** Lê o arquivo de senhas: e-mail -> senha. */
export function lerSenhas(conteudo: string): Map<string, string> {
  const senhas = new Map<string, string>();
  for (const linha of conteudo.split(/\r?\n/)) {
    if (!linha || linha.startsWith('#')) continue;
    const [email, , senha] = linha.split('\t');
    if (email && senha) senhas.set(email, senha);
  }
  return senhas;
}

/** No Windows: tira a herança e deixa acesso total só para o usuário atual. Devolve se conseguiu. */
function restringirNoWindows(arquivo: string): boolean {
  const { username } = userInfo();
  const usuario = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${username}` : username;
  const r = spawnSync('icacls', [arquivo, '/inheritance:r', '/grant:r', `${usuario}:F`], { encoding: 'utf8', windowsHide: true });
  return !r.error && r.status === 0;
}

export interface GravacaoPendente {
  /** Torna o arquivo definitivo (rename atômico do temporário). */
  confirmar(): void;
  /** Apaga o temporário (o seed falhou: as senhas dele não valem). */
  descartar(): void;
  /** true se, no Windows, o icacls não conseguiu restringir o acesso. */
  avisoPermissao: boolean;
}

/**
 * Grava `conteudo` num temporário (0600, na mesma pasta do destino) ANTES de mexer no banco, para
 * que um destino sem permissão de escrita falhe cedo. `confirmar()` faz o rename depois que o banco
 * foi gravado; `descartar()` apaga o temporário se o seed falhar.
 */
export function prepararGravacao(destino: string, conteudo: string): GravacaoPendente {
  const pasta = dirname(destino);
  mkdirSync(pasta, { recursive: true, mode: 0o700 });
  const temporario = join(pasta, `.${basename(destino)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const fd = openSync(temporario, 'wx', 0o600);
  let avisoPermissao = false;
  try {
    if (process.platform === 'win32') avisoPermissao = !restringirNoWindows(temporario);
    else chmodSync(temporario, 0o600); // o umask não afrouxa, mas garante
    writeSync(fd, conteudo);
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    rmSync(temporario, { force: true });
    throw e;
  }
  closeSync(fd);
  return {
    avisoPermissao,
    confirmar() {
      renameSync(temporario, destino);
      if (process.platform !== 'win32') chmodSync(destino, 0o600);
    },
    descartar() {
      rmSync(temporario, { force: true });
    },
  };
}
