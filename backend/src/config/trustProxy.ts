// Quantos proxies reversos ficam na frente da API (TRUST_PROXY), para o Express calcular o
// `req.ip` a partir do X-Forwarded-For. So aceita o NUMERO de saltos, inteiro de 0 a 5:
//  - ausente, vazio ou "0": o app nem chama `app.set('trust proxy')` (como sempre foi). O
//    `req.ip` e o endereco do socket, ou seja, o IP do proxy mais proximo: impreciso atras de
//    proxy, mas impossivel de forjar pelo cliente;
//  - "1" a "5": `app.set('trust proxy', n)`. O Express pula os n saltos mais a direita do
//    X-Forwarded-For e usa o que sobrar: so vale se a cadeia real tiver EXATAMENTE n proxies
//    (cada um acrescentando o endereco de quem o chamou). A VM mede a cadeia antes de definir
//    (Funnel = 1; Funnel + Nginx = 2);
//  - qualquer outro valor: a API RECUSA subir. "true" e recusado de proposito: com ele o
//    Express confia em TODO o X-Forwarded-For e usa o endereco mais a esquerda, que o proprio
//    cliente escreve, entao qualquer um forjaria o IP. "false", "loopback", lista de IPs/sub-redes,
//    negativo, decimal e texto tambem sao recusados: um formato so, sem ambiguidade.
//
// Hoje o unico uso de `req.ip` e o registro de abertura do link do e-mail da campanha
// (Melhorias #6, treinamento.controller.ts). Os limites de login e de pedido de redefinicao de
// senha (DT09) sao por conta/e-mail, NAO por IP: TRUST_PROXY nao muda nenhum limite.

export const TRUST_PROXY_MAX = 5;

/** Valor de TRUST_PROXY fora do formato aceito: a API nao deve subir com ele. */
export class TrustProxyInvalido extends Error {}

/**
 * Le TRUST_PROXY e devolve o numero de saltos (0 = nao confiar em proxy). Lanca
 * TrustProxyInvalido para qualquer valor fora de "", "0" ... "5".
 */
export function lerTrustProxy(valor: string | undefined = process.env.TRUST_PROXY): number {
  const texto = valor ?? '';
  if (texto === '') return 0;
  if (!/^[0-9]$/.test(texto) || Number(texto) > TRUST_PROXY_MAX)
    throw new TrustProxyInvalido(
      `TRUST_PROXY inválido (${JSON.stringify(valor)}): use o número de proxies na frente da API, ` +
        `inteiro de 0 a ${TRUST_PROXY_MAX} (vazio ou 0 = nenhum). "true", listas de IPs e outros ` +
        'formatos do Express são recusados: "true" deixaria o cliente forjar o IP pelo X-Forwarded-For.',
    );
  return Number(texto);
}
