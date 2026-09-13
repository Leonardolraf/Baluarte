# Baluarte — sistema visual

Guia curto para quem mexe nas telas. Os tokens vivem em `tailwind.config.cjs` e `src/styles/tailwind.css`; este arquivo explica as decisões e o ritmo de espaçamento que toda tela deve seguir.

## Tese

**A única cor cromática da interface é o risco.** Severidade (crítico, alto, médio, baixo, informativo) e status (ativa, agendada, clicou, reportou…) são as únicas coisas coloridas na tela. Tudo que é interativo é monocromático: botão primário, link, foco, item ativo do menu e interruptores usam a tinta `ink` (`#0B1220`). Assim o olho do analista só é puxado por cor quando existe risco a olhar.

Público: equipes de segurança e TI de empresas de médio porte (telas técnicas densas, como o VirusTotal) e colaboradores que caem no treinamento depois de um clique em phishing (tela calma, sem culpa).

## Cor

| Token | Valor | Uso |
|---|---|---|
| `ink` | `#0B1220` | texto principal, barra lateral, placa do dashboard, ações primárias |
| `ink-soft` | `#1B2A44` | hover das ações primárias, item ativo do menu |
| `slate-100` | `#EEF2F7` | fundo da página (claro) |
| `slate-200` | `#DCE3EC` | bordas |
| `slate-600` | `#5B6B85` | texto secundário e rótulos em caixa alta (≥ 4,5:1 sobre branco) |
| `slate-900` | `#131C2E` | superfícies no tema escuro |
| `slate-950` | `#0B1220` | fundo da página no tema escuro |
| `severity-*` | ver `src/lib/severity.ts` | somente indicadores de risco |

A escala `slate` do Tailwind foi **sobrescrita** por esses neutros com tinta de aço-azulado: as classes `slate-*` existentes continuam válidas e já saem na paleta nova. `brand` é um alias de `ink` mantido por compatibilidade.

Sobre a placa escura (`.plate`), texto de severidade usa os tons 300 (`SEVERITY_PLATE_TEXT_CLASS`).

## Tipografia

| Papel | Fonte | Onde |
|---|---|---|
| Display | **Archivo** (variável, eixo de largura) | títulos de página (`.display`, 28 px, largura 112 %), numerais de KPI e dos medidores (`.numeral`, largura 118 %, peso 800), marca |
| Corpo | **IBM Plex Sans** (variável) | todo o resto; 14 px base, 13 px em tabelas |
| Dados | **IBM Plex Mono** | CVE, host, IP, hash, vetor CVSS, e-mails em tabelas, busca global |

As fontes são servidas do próprio bundle (`@fontsource-*`, importadas em `src/main.tsx`): nenhuma chamada ao Google Fonts, o que também simplifica a CSP.

Rótulos em caixa alta (`.label-caps`): 11 px, peso 600, espaçamento 0,08 em, cor `slate-600`.

## Ritmo de espaçamento (base 4 px)

| Onde | Valor |
|---|---|
| Inset da página | 16 px (celular) · 24 px (tablet) · 32 px (desktop) — `p-4 sm:p-6 lg:p-8` |
| Entre seções da página | 24 px — `space-y-6` |
| Cabeçalho da página → conteúdo | 24 px — `PageHeader` já traz `mb-6` |
| Cartão: cabeçalho | 20 px horizontal · 16 px vertical — `px-5 py-4` |
| Cartão: corpo | 20 px — `p-5` (16 px no celular quando apertado: `p-4 sm:p-5`) |
| Cartão: rodapé | 20 px horizontal · 12 px vertical — `px-5 py-3` |
| Tabela dentro de cartão | células 16 px horizontal, **primeira e última a 20 px** (alinhadas ao cabeçalho do cartão); cabeçalho 10 px vertical, linhas 12 px |
| Paginação | 20 px horizontal · 12 px vertical |
| Grade de cartões | 24 px — `gap-6` |
| Grade de KPIs / tiles | 12 px na placa, 16 px fora — `gap-3` / `gap-4` |
| Formulário | 20 px entre campos e entre colunas — `space-y-5`, `gap-5`; rótulo → controle 6 px; dica/erro 4 px |
| Botões | sm 32 px de altura / 12 px lateral · md 40 / 16 · lg 44 / 20 |
| Barra lateral | cabeçalho 56 px (mesma altura da barra superior); itens 36 px de altura, inset 12 px; grupos a 20 px |
| Barra superior | 56 px |

Regra prática: **dentro de um cartão, tudo alinha no inset de 20 px** (título, texto, primeira célula da tabela, paginação, rodapé). Fora dele, a grade da página manda.

## Componentes-assinatura

- **Placa de comando** (`Plate`, dashboard): superfície `ink` com os dois medidores e os seis KPIs num só bloco. É o único lugar escuro da página clara; o resto fica quieto.
- **Medidor de risco humano em traços**: 24 segmentos discretos, um para cada fatia da população; o risco técnico é um arco contínuo. A geometria diz o que a cor não precisa dizer.
- **Marca**: baluarte (planta pentagonal) em `BaluarteMark`; favicon em `public/baluarte.svg`.

## O que não fazer

- Cor em botão, link ou menu: não. Cor é risco.
- Padding "à mão" fora do ritmo (13 px, 18 px, 22 px…). Se um valor não está na tabela acima, provavelmente é um erro.
- Fonte importada de fora do bundle.
- Cabeçalho de cartão com um inset e tabela com outro.
