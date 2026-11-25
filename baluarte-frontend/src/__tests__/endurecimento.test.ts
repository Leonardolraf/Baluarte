// Melhoria 14: React DevTools desligado em produção e cabeçalhos de segurança da demo.
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { desligarReactDevTools } from '@/lib/devtools';

type Gancho = Record<string, unknown> & { isDisabled?: boolean };

describe('desligarReactDevTools', () => {
  it('sem extensão, instala um gancho inerte que o React ignora', () => {
    const janela: { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Gancho } = {};
    expect(desligarReactDevTools(janela)).toBe(true);
    const gancho = janela.__REACT_DEVTOOLS_GLOBAL_HOOK__!;
    expect(gancho.isDisabled).toBe(true);
    expect((gancho.inject as () => unknown)()).toBeUndefined();
  });

  it('com a extensão presente, esvazia os pontos de entrada do mesmo objeto', () => {
    let chamadas = 0;
    const original = () => {
      chamadas += 1;
    };
    const gancho: Gancho = { inject: original, onCommitFiberRoot: original, outraCoisa: 1 };
    const janela = { __REACT_DEVTOOLS_GLOBAL_HOOK__: gancho };
    expect(desligarReactDevTools(janela)).toBe(true);
    expect(janela.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(gancho);
    expect(gancho.isDisabled).toBe(true);
    (gancho.onCommitFiberRoot as () => void)();
    (gancho.inject as () => void)();
    expect(chamadas).toBe(0);
    expect(gancho.outraCoisa).toBe(1);
  });

  it('gancho congelado não derruba o app: devolve false em vez de lançar', () => {
    const janela = { __REACT_DEVTOOLS_GLOBAL_HOOK__: Object.freeze({ inject: () => 1 }) as Gancho };
    expect(() => desligarReactDevTools(janela)).not.toThrow();
    expect(desligarReactDevTools(janela)).toBe(false);
  });
});

const ler = (relativo: string) => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), 'utf8');

describe('cabeçalhos de segurança (vercel.json e nginx)', () => {
  const vercel = JSON.parse(ler('../../vercel.json')) as {
    rewrites: { source: string; destination: string }[];
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const cabecalhos = Object.fromEntries(
    vercel.headers.flatMap((h) => h.headers).map((h) => [h.key, h.value]),
  );

  it('mantém o rewrite do SPA', () => {
    expect(vercel.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }]);
  });

  it('manda os quatro cabeçalhos fixos e a CSP SÓ em modo relatório', () => {
    expect(cabecalhos['X-Content-Type-Options']).toBe('nosniff');
    expect(cabecalhos['X-Frame-Options']).toBe('DENY');
    expect(cabecalhos['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(cabecalhos['Permissions-Policy']).toMatch(/camera=\(\)/);
    expect(cabecalhos['Content-Security-Policy-Report-Only']).toBeTruthy();
    // A bloqueante não entra sem uma passagem por todas as telas sem violação no console.
    expect(cabecalhos['Content-Security-Policy']).toBeUndefined();
  });

  it('a CSP da Vercel libera a API do Funnel e não libera script inline', () => {
    const csp = cabecalhos['Content-Security-Policy-Report-Only'];
    expect(csp).toMatch(/connect-src 'self' https:\/\/baluarte\.tail862474\.ts\.net;/);
    expect(csp).toMatch(/script-src 'self';/);
    expect(csp).not.toMatch(/unsafe-eval/);
  });

  it('o Nginx do Docker manda os mesmos cabeçalhos, também só em modo relatório', () => {
    const app = ler('../../nginx/app.conf');
    const mapas = ler('../../nginx/mapas.conf');
    expect(app).not.toMatch(/add_header Content-Security-Policy /);
    expect(app.match(/Content-Security-Policy-Report-Only \$baluarte_csp/g)).toHaveLength(3);
    expect(app.match(/add_header Permissions-Policy "([^"]+)"/)?.[1]).toBe(cabecalhos['Permissions-Policy']);
    // Mesma política, trocando só a origem da API (no Docker ela é same-origin, /api).
    const cspNginx = mapas.match(/map \$host \$baluarte_csp \{\s*default "([^"]+)";/)?.[1];
    expect(cspNginx).toBe(
      cabecalhos['Content-Security-Policy-Report-Only'].replace(' https://baluarte.tail862474.ts.net', ''),
    );
  });
});
