// Guarda do X-Real-IP (config/trustProxy.ts): o cliente controla esse cabecalho e nenhum proxy
// da cadeia (Tailscale Funnel) o reescreve, entao a API nao deve le-lo. O IP do cliente e so o
// `req.ip`, calculado do X-Forwarded-For com TRUST_PROXY. Sem banco: varre o texto de src/.
// Linhas que sao so comentario ficam de fora (o proprio aviso em trustProxy.ts cita o nome);
// qualquer linha de codigo com o nome do cabecalho, em qualquer caixa, faz o teste falhar.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? arquivos(caminho) : [caminho];
  });
}

/**
 * Linha que e so comentario: `//`, ou `/*`, `/**` ou continuacao ` * ` de bloco SEM codigo
 * depois de um `*\/` (`/* x *\/ req.get('x-real-ip')` conta como leitura).
 */
function soComentario(linha: string): boolean {
  if (/^\s*\/\//.test(linha)) return true;
  if (!/^\s*(\/\*|\*)/.test(linha)) return false;
  const fim = linha.lastIndexOf('*/');
  return fim === -1 || linha.slice(fim + 2).trim() === '';
}
const X_REAL_IP = /x-real-ip/i;

/** Ocorrencias do cabecalho em linhas de codigo de src/, como "arquivo:linha: texto". */
function leiturasDeXRealIp(raiz: string = SRC): string[] {
  return arquivos(raiz).flatMap((arquivo) =>
    readFileSync(arquivo, 'utf8')
      .split(/\r?\n/)
      .flatMap((linha, i) =>
        X_REAL_IP.test(linha) && !soComentario(linha)
          ? [`${relative(raiz, arquivo).replaceAll('\\', '/')}:${i + 1}: ${linha.trim()}`]
          : [],
      ),
  );
}

describe('X-Real-IP não é lido pela API', () => {
  it('nenhum arquivo de src/ lê o cabeçalho X-Real-IP (fora comentários)', () => {
    assert.deepEqual(leiturasDeXRealIp(), []);
  });

  it('o aviso em config/trustProxy.ts continua lá (e não conta como leitura)', () => {
    const texto = readFileSync(join(SRC, 'config', 'trustProxy.ts'), 'utf8');
    assert.match(texto, /X-Real-IP NAO e confiavel/);
  });

  it('o detector pega leitura em qualquer caixa e em subpasta, e ignora so comentario', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'sem-x-real-ip-'));
    try {
      mkdirSync(join(raiz, 'sub'));
      writeFileSync(
        join(raiz, 'a.ts'),
        [
          '// aviso: X-Real-IP nao e confiavel',
          '/* bloco que cita x-real-ip */',
          ' * continuacao de bloco com X-REAL-IP',
          "const ip = req.get('X-Real-IP');",
          "/* antes */ const h = req.headers['x-real-ip'];",
          "const u = 'http://exemplo'; const v = req.header('x-ReAl-iP');",
        ].join('\n'),
      );
      writeFileSync(join(raiz, 'sub', 'b.ts'), "export const ler = (req) => req.get('x-real-ip');\r\n");
      assert.deepEqual(leiturasDeXRealIp(raiz).sort(), [
        "a.ts:4: const ip = req.get('X-Real-IP');",
        "a.ts:5: /* antes */ const h = req.headers['x-real-ip'];",
        "a.ts:6: const u = 'http://exemplo'; const v = req.header('x-ReAl-iP');",
        "sub/b.ts:1: export const ler = (req) => req.get('x-real-ip');",
      ]);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });
});
