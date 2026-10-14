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
// Precisa rodar ANTES de o React carregar: por isso este módulo é o primeiro
// `import` de `main.tsx` (imports ES executam na ordem em que aparecem).
// -----------------------------------------------------------------------------

type GanchoDevTools = Record<string, unknown> & { isDisabled?: boolean };

if (import.meta.env.PROD && typeof window !== 'undefined') {
  const janela = window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: GanchoDevTools };
  const gancho = janela.__REACT_DEVTOOLS_GLOBAL_HOOK__;

  if (gancho) {
    // Extensão já presente: marca como desligada e esvazia os pontos de entrada que
    // o React chama para registrar a árvore.
    gancho.isDisabled = true;
    for (const chave of ['inject', 'onCommitFiberRoot', 'onCommitFiberUnmount', 'onScheduleFiberRoot']) {
      if (typeof gancho[chave] === 'function') gancho[chave] = () => undefined;
    }
  } else {
    // Extensão ainda não instalou o gancho (ou não existe): deixa um substituto
    // inerte, que o React encontra e usa sem registrar nada.
    janela.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      isDisabled: true,
      supportsFiber: true,
      inject: () => undefined,
      onCommitFiberRoot: () => undefined,
      onCommitFiberUnmount: () => undefined,
      onScheduleFiberRoot: () => undefined,
      renderers: new Map(),
    };
  }
}

export {};
