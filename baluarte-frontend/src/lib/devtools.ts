// -----------------------------------------------------------------------------
// Melhoria 14 (c): desligar o React DevTools no bundle de produção.
//
// O DevTools do React se conecta por um gancho global que a própria extensão
// instala na página (`__REACT_DEVTOOLS_GLOBAL_HOOK__`) antes de o React carregar.
// Neutralizando o gancho, a extensão não consegue montar a árvore de componentes
// nem inspecionar props e estado do app publicado.
//
// Honestidade sobre o alcance: isto NÃO esconde o código nem protege segredo
// nenhum — o bundle continua baixável e legível no DevTools do navegador. Serve
// para não entregar de bandeja a árvore de componentes com os dados em memória.
// Quem quiser inspecionar ainda consegue, só não com um clique.
//
// Ordem: este módulo é o primeiro `import` de `main.tsx`. Mesmo que o React DOM
// (chunk separado) avalie antes e já tenha se registrado no gancho da extensão, o
// React chama `onCommitFiberRoot` do MESMO objeto a cada render; trocar esses
// métodos aqui corta o envio da árvore depois do registro também.
//
// Nunca pode derrubar o app: qualquer exceção (gancho congelado, propriedade só
// de leitura) é engolida — no pior caso o DevTools continua funcionando.
// -----------------------------------------------------------------------------

type GanchoDevTools = Record<string, unknown> & { isDisabled?: boolean };
type JanelaComGancho = { __REACT_DEVTOOLS_GLOBAL_HOOK__?: GanchoDevTools };

const PONTOS_DE_ENTRADA = [
  'inject',
  'onCommitFiberRoot',
  'onCommitFiberUnmount',
  'onPostCommitFiberRoot',
  'onScheduleFiberRoot',
];

const nada = () => undefined;

/** Neutraliza o gancho do React DevTools na janela dada. Devolve `true` se conseguiu. */
export function desligarReactDevTools(janela: JanelaComGancho): boolean {
  try {
    const gancho = janela.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (gancho) {
      // Extensão já presente: marca como desligada e esvazia os pontos de entrada que
      // o React chama para registrar e atualizar a árvore.
      gancho.isDisabled = true;
      for (const chave of PONTOS_DE_ENTRADA) {
        if (typeof gancho[chave] === 'function') gancho[chave] = nada;
      }
    } else {
      // Extensão ainda não instalou o gancho (ou não existe): deixa um substituto
      // inerte, que o React encontra e ignora (isDisabled).
      janela.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        isDisabled: true,
        supportsFiber: true,
        inject: nada,
        onCommitFiberRoot: nada,
        onCommitFiberUnmount: nada,
        onPostCommitFiberRoot: nada,
        onScheduleFiberRoot: nada,
        renderers: new Map(),
      };
    }
    return true;
  } catch {
    return false;
  }
}

// Só no bundle de produção: em `npm run dev` e nos testes o DevTools segue disponível.
if (import.meta.env.PROD && typeof window !== 'undefined') {
  desligarReactDevTools(window as unknown as JanelaComGancho);
}
