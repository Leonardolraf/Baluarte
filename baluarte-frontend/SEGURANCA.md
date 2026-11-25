# Segurança do frontend publicado

> Melhoria 14 ("endurecer o frontend / reduzir exposição no F12"). Este documento diz o que
> já protege, o que foi acrescentado e — principalmente — **o que não dá para proteger**.

## O limite honesto, primeiro

**O código do frontend é sempre inspecionável no F12.** O bundle é baixado e executado pelo
navegador da pessoa: ele está, por definição, na máquina dela. Minificação dificulta a
leitura casual; não impede leitura nenhuma. Qualquer pessoa com o DevTools do próprio
navegador recupera a lógica, as rotas da API e os textos da interface.

O que de fato protege o sistema não é esconder o código do cliente — é **o servidor não
confiar nele**. No Baluarte isso é verdade e é testado:

- O RBAC é decidido no servidor a cada requisição: `exigeToken` carrega o usuário do banco
  (perfil atual, conta inativa ou removida, senha redefinida) e `exigePerfil` decide pelo
  perfil do banco, não pelo que está no JWT nem pelo que a tela mostra.
- O teste **S1** (`backend/tests/seguranca/autorizacao.test.ts`) lê a lista de rotas do
  próprio roteador e confere que **todas as 47 rotas protegidas (47/47)** respondem
  `401 TOKEN_AUSENTE` sem token; rota nova com `exigeToken` entra na conta sozinha. Os casos
  de perfil errado (`403 PERFIL_SEM_PERMISSAO`) são testados no mesmo arquivo.

Esconder um botão no frontend é conforto visual; quem recusa a ação é a API. Tudo o que está
abaixo **só reduz exposição** — não é a barreira de segurança do sistema.

## O que já protegia antes desta melhoria

| Medida                             | Onde                                                  | O que faz                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Sem source map em produção         | `vite.config.ts` (`sourcemap: mode !== 'production'`) | O DevTools mostra o bundle minificado, sem o TypeScript/JSX original nem a árvore de `src/`.                                                |
| `console.*` e `debugger` removidos | `vite.config.ts` (`esbuild.drop`)                     | Nenhum rastro de depuração no app publicado.                                                                                                |
| Nenhum segredo no bundle           | —                                                     | No bundle publicado só aparece a URL pública da API, que é pública por definição. **Toda variável `VITE_` vira JavaScript público** (DT20). |
| Fontes servidas do próprio bundle  | `main.tsx` (`@fontsource*`)                           | Nenhuma chamada ao Google Fonts: menos terceiros e uma CSP mais fechada.                                                                    |
| Token fora de cookie               | `lib/storage.ts`                                      | Sem cookie implícito, o CSRF clássico não se aplica a estas rotas.                                                                          |
| Cabeçalhos no Nginx do Docker      | `nginx/app.conf`                                      | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS no HTTPS.                                                              |

Esses cabeçalhos valiam só para o frontend servido pelo **Nginx do Docker** (`:8081`/`:8443`).
A **demo pública está na Vercel**, que não lê o `nginx/app.conf`, e respondia só com o HSTS
que a própria Vercel acrescenta (conferido em 24/11/2026).

## O que esta melhoria acrescentou

### 1. Cabeçalhos de segurança na demo pública (`vercel.json`)

Ao lado do rewrite do SPA, que não muda:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()`

O app não usa nenhum desses recursos (a única API sensível usada é a área de transferência,
que não entra no `Permissions-Policy`). Os mesmos cabeçalhos estão no Nginx do Docker.

### 2. Política de segurança de conteúdo (CSP), **só em modo relatório**

Entra como `Content-Security-Policy-Report-Only`, na Vercel e no Nginx
(`nginx/mapas.conf`, variável `$baluarte_csp`). O navegador **avisa** no console o que
violaria a política e **não bloqueia nada**. Não há `report-uri`: as violações aparecem só no
console de quem abre a página.

É deliberado: CSP mal ajustada quebra a tela em silêncio — sem erro no servidor, só um
componente que não aparece. Virar bloqueante (`Content-Security-Policy`) é uma segunda
decisão, depois de abrir todas as telas com o console aberto e zero violação. **Não fazer
essa troca às vésperas de uma demonstração.** O teste `src/__tests__/endurecimento.test.ts`
falha se a bloqueante entrar no `vercel.json` ou no Nginx.

Política da Vercel:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self' https://baluarte.tail862474.ts.net; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'
```

No Nginx é a mesma, sem a origem do Funnel (no Docker a API é `/api`, mesma origem).

Cada diretiva saiu do código e do build (`dist/`), não de lista genérica:

| Diretiva                                | Valor                                           | De onde veio                                                                                                                                                                                                                                 |
| --------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script-src`                            | `'self'`                                        | O `dist/index.html` tem um único `<script>`, externo. O Vercel Analytics (`<Analytics />` em `main.tsx`) carrega `/_vercel/insights/script.js` e envia para `/_vercel/insights/*`, mesma origem. O bundle não usa `eval` nem `new Function`. |
| `style-src`                             | `'self' 'unsafe-inline'`                        | O `react-hot-toast` (goober) injeta um elemento `<style>` com o CSS dos avisos.                                                                                                                                                              |
| `img-src`                               | `'self'`                                        | Só o favicon `/baluarte.svg`; os ícones são SVG no JSX e o build não gera `data:` em CSS nem em JS.                                                                                                                                          |
| `font-src`                              | `'self'`                                        | 29 arquivos `.woff`/`.woff2` do `@fontsource`, em `/assets/`.                                                                                                                                                                                |
| `connect-src`                           | `'self'` + `https://baluarte.tail862474.ts.net` | A API de produção (`VITE_API_BASE_URL` da Vercel, conferida no bundle publicado) e o Analytics (mesma origem).                                                                                                                               |
| `frame-ancestors`                       | `'none'`                                        | O `X-Frame-Options: DENY` na versão que os navegadores novos respeitam.                                                                                                                                                                      |
| `base-uri`, `object-src`, `form-action` | `'none'` / `'none'` / `'self'`                  | Fecham injeção de `<base>`, plugins e envio de formulário para fora (todos os formulários do app são tratados em JavaScript).                                                                                                                |

**`blob:` não aparece de propósito:** o download do PDF e do Excel (`lib/download.ts`) cria uma
URL `blob:` e clica num `<a download>`. Isso é navegação/download, não carga de recurso, e
nenhuma diretiva de CSP o controla. Se um dia o PDF passar a abrir numa aba ou num `<iframe>`
do próprio app, a política precisa ser revista.

A CSP é a **única** das medidas desta página que mitiga um ataque real (XSS) — e só quando
virar bloqueante.

### 3. React DevTools desligado em produção

`src/lib/devtools.ts`, importado como primeiro módulo de `main.tsx`, só quando
`import.meta.env.PROD` (no `npm run dev` e nos testes o DevTools segue funcionando).
Neutraliza o gancho global que a extensão usa (`__REACT_DEVTOOLS_GLOBAL_HOOK__`): marca como
desligado e troca por funções vazias os pontos que o React chama a cada render. O React DOM
fica num chunk separado e pode se registrar no gancho antes deste módulo rodar; mesmo assim a
árvore não chega à extensão, porque o React chama `onCommitFiberRoot` do mesmo objeto a cada
render. A função engole qualquer exceção (gancho congelado, por exemplo): no pior caso o
DevTools continua funcionando, e o app nunca deixa de abrir por causa disso.

Alcance honesto: **não esconde código nem dado**. O estado continua na memória da página e
acessível a quem souber procurar (breakpoint, console, aba Rede). Evita só a inspeção trivial
da árvore de componentes com um clique.

## Ofuscação do bundle — não entrou

A ofuscação foi avaliada (branch `chore/ofuscar-bundle`) e **ficou de fora da entrega**:

- **Não protege nada.** O código continua completo no navegador; desofuscadores públicos
  revertem a maior parte em minutos.
- **Custa de verdade.** Dependência nova de build, build mais lento, bundle maior e pilhas de
  erro de produção ilegíveis.
- **Pode quebrar em silêncio.** O defeito aparece em runtime, não no build.

Num trabalho de cibersegurança, apresentá-la como medida de proteção é o tipo de afirmação que
um avaliador derruba com uma pergunta.

## O que ainda daria ganho real, em ordem

1. **Virar a CSP para bloqueante**, depois de uma passagem por todas as telas com o console
   aberto e zero violação. É o único item desta lista que impede um ataque.
2. **Deployment Protection nos previews da Vercel** — cada branch publica um preview público.
3. **Separar um papel de aplicação no banco**, sem permissão de desligar os triggers de
   imutabilidade da auditoria (limite registrado no `CLAUDE.md` do repositório).
