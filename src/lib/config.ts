/**
 * Configuração de ambiente do app.
 *
 * O app roda em dois modos, escolhidos pela variável `EXPO_PUBLIC_API_BASE_URL`:
 *
 * - **Modo demo (padrão):** sem a variável, tudo vem dos dados em memória
 *   (`src/data/*`). A autenticação é simulada e nada é enviado de verdade.
 *   É o modo demo-safe: funciona offline e os testes rodam aqui.
 * - **Modo API:** com a variável apontando para a API do produto
 *   (ex.: `https://baluarte.tail862474.ts.net/api`), o app faz login real,
 *   guarda o token em armazenamento seguro e lê as campanhas da API.
 *
 * A base URL NUNCA fica no código: só vem do ambiente (prefixo `EXPO_PUBLIC_`,
 * que o Expo injeta no bundle). Não é segredo — é só o endereço público da API.
 */

/** Base URL da API, sem a barra final; `null` quando o app está em modo demo. */
export const API_BASE_URL: string | null = normalizeBaseUrl(
  process.env.EXPO_PUBLIC_API_BASE_URL,
);

/** `true` quando há uma API configurada (modo API); `false` no modo demo. */
export const IS_API_MODE = API_BASE_URL !== null;

function normalizeBaseUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  // Remove barras finais para montar os caminhos com `${base}/login`.
  return trimmed.replace(/\/+$/, '');
}
