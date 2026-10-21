// Configuração global dos testes (jest-expo + Testing Library).
// As matchers do Testing Library (toBeOnTheScreen etc.) já vêm com qualquer import do pacote.

// Os testes rodam com relógio real; quem precisa de fake timers liga no próprio arquivo.
afterEach(() => {
  jest.useRealTimers();
});
