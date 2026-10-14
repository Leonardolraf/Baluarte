# Segurança do frontend publicado

> Melhoria 14. O pedido foi "endurecer o front e o que se vê no F12". Este documento diz o
> que já protege, o que foi acrescentado e — principalmente — **o que não dá para proteger**,
> porque afirmação exagerada sobre segurança é o tipo de coisa que não sobrevive a uma pergunta.

## O limite honesto, primeiro

**Não existe esconder código de quem abre o F12.** O bundle é baixado e executado pelo
navegador da pessoa: ele está, por definição, na máquina dela. Minificação e ofuscação
dificultam a leitura casual; não impedem leitura nenhuma. Qualquer pessoa com o próprio
DevTools (ou um desofuscador público) recupera a lógica em minutos.

O que de fato protege um sistema não é esconder o código do cliente — é **o servidor não
confiar nele**. No Baluarte isso já é verdade: o RBAC é decidido no servidor a cada
requisição (`exigeToken` carrega o usuário do banco, `exigePerfil` decide pelo perfil do
banco, não pelo que está no JWT). Esconder um botão no frontend é conforto visual; quem
recusa a ação é a API.

## O que já protegia, antes desta melhoria

| Medida | Onde | O que faz |
|---|---|---|
| Sem source map em produção | `vite.config.ts` (`sourcemap: mode !== 'production'`) | O DevTools mostra o bundle minificado, sem o TypeScript/JSX original nem a árvore de `src/`. |
| `console.*` e `debugger` removidos | `vite.config.ts` (`esbuild.drop`) | Nenhum rastro de depuração no app publicado. |
| Nenhum segredo no bundle | — | Verificado baixando os chunks publicados: só aparece a URL pública da API, que é pública por definição. **Toda variável `VITE_` vira JavaScript público** (DT20) — é por isso que endereço de pessoa nunca entra em `VITE_DOMINIO_INTERNO`. |
| Fontes servidas do próprio bundle | `main.tsx` (`@fontsource*`) | Nenhuma chamada ao Google Fonts: menos terceiros, e uma CSP mais fechada fica possível. |
| Token fora de cookie de sessão | `lib/storage.ts` | Sem cookie implícito, o CSRF clássico não se aplica a estas rotas. |
| Cabeçalhos de segurança no Nginx | `nginx/app.conf` | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS no HTTPS. |

**Descoberta ao escrever este documento:** aqueles cabeçalhos valiam só para o frontend
servido pelo **Nginx do Docker** (`:8081`). A **demo pública está na Vercel**, que não lê o
`nginx/app.conf` — e respondia **sem nenhum** deles, só com o HSTS que a própria Vercel
adiciona. Ou seja, o endurecimento existia no ambiente que ninguém de fora acessa.

## O que esta melhoria acrescentou

### 1. Cabeçalhos de segurança na demo pública (`vercel.json`)

`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin` e um `Permissions-Policy` que desliga
câmera, microfone, geolocalização, pagamento e USB. São cabeçalhos inertes para o app e
fecham, de fato, enquadramento em iframe e vazamento de referenciador.

### 2. Política de segurança de conteúdo (CSP), **em modo relatório**

Entra como `Content-Security-Policy-Report-Only`, na Vercel e no Nginx
(`nginx/mapas.conf`, variável `$baluarte_csp`). O navegador **avisa** o que violaria a
política e **não bloqueia nada**.

Isso é deliberado: CSP mal ajustada quebra a tela em silêncio — sem erro no servidor, sem
log, só um componente que não aparece. Virar bloqueante é uma segunda decisão, depois de
abrir as telas e confirmar que o console não acusa violação. **Não fazer essa troca às
vésperas de uma demonstração.**

A política e o porquê de cada diretiva:

| Diretiva | Valor | Razão |
|---|---|---|
| `script-src` | `'self'` | O build não emite script inline — conferido no `dist/index.html` gerado (1 script, externo). |
| `style-src` | `'self' 'unsafe-inline'` | O React escreve estilo em **atributo** (`style={{ width }}` nas barras e medidores). Sem `'unsafe-inline'`, as barras do dashboard somem. |
| `img-src` | `'self' data:` | Ícones SVG embutidos e o PDF do modo mock. |
| `connect-src` | `'self'` + a URL da API | No Docker a API é same-origin; na Vercel, o Funnel. |
| `frame-ancestors` | `'none'` | O `X-Frame-Options` na versão que os navegadores novos respeitam. |
| `base-uri`, `object-src`, `form-action` | `'none'` / `'none'` / `'self'` | Fecham injeção de `<base>`, plugins e envio de formulário para fora. |

A CSP é a **única** das três barreiras que mitiga um ataque real (XSS): mesmo que algum
script estranho chegue à página, ele não executa nem conversa com um servidor de fora.

### 3. React DevTools desligado em produção

`src/lib/devtools.ts`, importado como primeiro módulo de `main.tsx` (imports ES executam na
ordem em que aparecem, então ele roda antes do React). Neutraliza o gancho global que a
extensão usa, e a árvore de componentes deixa de ser inspecionável com um clique.

Alcance honesto: **não esconde código nem dado**. O estado continua na memória da página e
acessível a quem souber procurar. Evita apenas a inspeção trivial.

## Ofuscação do bundle — pedida, e por que não entrou aqui

O pedido incluía ofuscar o bundle. Ela **não está implementada nesta entrega**, e a decisão
precisa ser explícita porque tem custo e não tem benefício de segurança:

- **Não protege nada.** Ver o primeiro parágrafo deste documento. O código continua
  completo no navegador; ofuscação é leitura mais chata, não barreira.
- **Custa de verdade.** Exige uma dependência nova de build (`javascript-obfuscator` ou
  equivalente), multiplica o tempo de build, aumenta o bundle, e torna qualquer pilha de erro
  de produção ilegível — num sistema que a equipe ainda vai operar até a entrega.
- **Pode quebrar em silêncio.** Ofuscadores agressivos mexem em nomes de propriedade e
  quebram código que depende deles; o defeito aparece em runtime, não no build.

Se mesmo assim for para entrar, que entre **nomeada pelo que é** em qualquer documento ou
apresentação: *dificulta a leitura casual do bundle; não protege segredo nenhum*. Num
trabalho de cibersegurança, apresentá-la como medida de proteção é o tipo de afirmação que
um avaliador derruba com uma pergunta.

## O que ainda daria ganho real, em ordem

1. **Virar a CSP para bloqueante**, depois de uma passagem por todas as telas com o console
   aberto e zero violação. É o único item desta lista que impede um ataque.
2. **Deployment Protection nos previews da Vercel** — hoje o projeto `baluarte-api` não tem,
   e cada branch publica um preview público.
3. **Separar um papel de aplicação no banco**, sem permissão de desligar os triggers de
   imutabilidade da auditoria (o próprio `CLAUDE.md` registra esse limite).
