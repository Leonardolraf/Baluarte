# Falhas INJETADAS de propósito para provar que os testes detectam o erro — não são defeitos do produto

Esta pasta tem duas partes, que não se misturam:

1. **Parte A, falhas injetadas (M1 a M4):** erros colocados de propósito no código, numa cópia descartável, no estilo de teste de mutação. Servem para mostrar que, se alguém introduzir esse erro, um teste existente fica vermelho. **O código do produto nunca teve esses erros.**
2. **Parte B, casos reais (`casos-reais/`):** defeitos que aconteceram de verdade e que um teste pegou, com a saída vermelha e a verde de cada um.

Data: 24/11/2026. Base: branch `claude/testes-jmeter-e774a0` no `3a191bc` (`20ef962` da `main` + commits só de teste). Máquina: Windows 11, Node 24.22.1, PostgreSQL 16 local (Docker). Nada tocou a VM, a Vercel ou o Supabase.

## Parte A: falhas injetadas

### Método

1. Criar uma worktree git descartável do mesmo commit, fora do repositório (`git worktree add --detach <pasta> HEAD`), com o `node_modules` e o `.env` do backend.
2. Para cada mutação: aplicar o patch (`git apply M<n>-*.patch`), rodar o arquivo de teste correspondente e guardar a saída (`M<n>-vermelho.txt`).
3. Reverter (`git checkout -- src`), conferir que `git diff -- src` está vazio (fica registrado no começo de `M<n>-verde.txt`), rodar o mesmo teste de novo e guardar a saída (`M<n>-verde.txt`).
4. Apagar a worktree no fim.

O script é o `rodar-mutacoes.sh` (`sh rodar-mutacoes.sh <worktree descartável> <esta pasta>`). Cada saída começa com o nome da mutação, a hora e o comando. **Nenhuma mutação foi aplicada no checkout do repositório.** No commit desta pasta, `git diff 20ef962 -- backend/src baluarte-frontend/src` está vazio.

### Resultados

| Caso | O que a mutação muda | Teste | Vermelho (com a mutação) | Verde (código original) |
|---|---|---|---|---|
| M1 | Tira o `exigeToken` do `POST /assets` (`backend/src/routes/ativo.routes.ts`) | `tests/seguranca/autorizacao.test.ts` | 22 aprovados, **5 falhas**, exit 1 | 27/27, exit 0 |
| M2 | Faixa CVSS "Alto": `cvss <= 8.9` vira `cvss < 8.9`, então a nota 8,9 cai em "Crítico" (`backend/src/services/cvss.service.ts`) | `tests/unidade/cvss-catalogo.test.ts` | 16 aprovados, **1 falha**, exit 1 | 17/17, exit 0 |
| M3 | Desliga o limite de login: `LOGIN_MAX_FALHAS` vai de 5 para 1000 (`backend/src/services/auth.service.ts`) | `tests/seguranca/conta-forca-bruta.test.ts` | 17 aprovados, **3 falhas**, exit 1 | 20/20, exit 0 |
| M4 | Escalada de privilégio: o `DELETE /users/:id` passa de `exigePerfil('Administrador')` para `exigePerfil(...OPERADORES)`, liberando o Analista (`backend/src/routes/usuario.routes.ts`) | `tests/seguranca/autorizacao.test.ts` | 25 aprovados, **2 falhas**, exit 1 | 27/27, exit 0 |

### O que cada caso prova

- **M1, rota protegida sem autenticação.** Falharam os testes "sem cabeçalho Authorization → TOKEN_AUSENTE", "sem token → 401 TOKEN_AUSENTE, sem ativo nem auditoria" (matriz do cartão #23) e o teste novo da S1, que lê todas as rotas do roteador. A mensagem é `esperava 401 TOKEN_AUSENTE, veio 403 … PERFIL_SEM_PERMISSAO`. Com a mutação, a rota passou a responder 403 em vez de 401: o `exigePerfil` ainda barrava o pedido, porque sem login não há perfil. A rota não chegou a ficar aberta, mas o contrato mudou, e os testes pegaram isso. Também valida o teste novo da S1 (`3a191bc`): se uma rota perde a proteção, ele fica vermelho.
- **M2, erro de limite na severidade.** Falhou "limites das faixas" em `cvss-catalogo.test.ts:55`: `faixaCvss(8.9)` deu `'Crítico'`, e o esperado era `'Alto'`. Prova que os testes conferem a borda da faixa (8,9 e 9,0), não só um valor do meio.
- **M3, proteção contra força bruta desligada.** Falharam "bloqueia com 429 MUITAS_TENTATIVAS após 5 falhas…", "o bloqueio é por conta…" e "o limitador também cobre e-mails inexistentes". A mensagem é `esperava 429 MUITAS_TENTATIVAS, veio 401 … CREDENCIAIS_INVALIDAS`: a sexta senha errada seguiu sendo avaliada.
- **M4, Analista com poder de Administrador.** Falharam "Analista lê listas técnicas mas não gerencia usuários" e "rebaixar um admin invalida o poder do token antigo". A mensagem é `esperava 403 PERFIL_SEM_PERMISSAO, veio 409 … USUARIO_COM_CIENCIA`. Ou seja, o Analista passou da autorização e chegou à regra de negócio da exclusão: o RBAC do servidor tinha sido quebrado, e o teste pegou.

### Arquivos

- `M1-sem-exigeToken.patch`, `M2-faixa-alto.patch`, `M3-sem-limite-login.patch`, `M4-analista-exclui-usuario.patch`: a mutação, como diff;
- `M<n>-vermelho.txt`: a saída real do teste com a mutação;
- `M<n>-verde.txt`: a saída real depois de reverter, com o `git diff -- src` vazio no cabeçalho;
- `rodar-mutacoes.sh`: o script que fez tudo isso.

## Parte B: casos reais (vermelho → verde)

Estes **não** foram injetados. São defeitos que existiram e que um teste pegou. Os logs são as saídas guardadas nas execuções de 24/11. O relato completo está no relatório da sessão "Testes JMeter".

| Caso | Nível | O defeito | Vermelho | Conserto | Verde |
|---|---|---|---|---|---|
| 1. DT28, porta 8080 (`casos-reais/1-dt28-porta-8080/`) | unitário | O teste do DT28 passava `PORT: '0'`, mas `src/server.ts` faz `Number(PORT) \|\| 8080`, então ele sempre subia na 8080 e falhava quando outro contêiner a ocupava | `vermelho.log`: 350/351, `Error: listen EADDRINUSE: address already in use :::8080` | `3a5008b`, só no teste: reserva uma porta livre e a passa ao processo filho | `verde.log`: 351/351, com a 8080 ainda ocupada (`porta-8080-ocupada-no-verde.txt`) |
| 2. Falso verde do PDF na carga (`casos-reais/2-pdf-falso-verde/`) | desempenho | Depois do DT36 (vaga única de exportação), o cenário do PDF seguia com 10 conexões e calculava o p95 com as recusas: 3.105 × 429 em 3.159 respostas, e mesmo assim "atende" | `vermelho.log` e `vermelho-resultados.json`: exit 0 com só 54 × 200 | `87a3459`: PDF com 1 usuário, percentis só de 2xx, resposta fora de 2xx reprova, e um cenário que exige 1 PDF + 2 × 429 em 3 exportações simultâneas | `verde.log`: 55/55 × 200, p95 de 574 ms; vaga única com 1 × 200 + 2 × 429 |
| 3. DT09, limite de login sob rajada (`casos-reais/3-dt09-limite-rajada/`) | integração/segurança | O login contava as falhas antes do bcrypt e gravava depois; 20 senhas erradas simultâneas liam "0 falhas" | `vermelho.log`: código do pai `64766a3` + o teste do conserto, **0/5**, `20 tentativas avaliaram a senha (limite 5)` | `4a7c00c` (08/10/2026): reserva a vaga antes do bcrypt | `verde.log`: 5/5 |
| 4. DT10, histórico de status fora de ordem (`casos-reais/4-dt10-historico-ordem/`) | integração | O evento de status recebia o `now()` do início da instrução, antes de esperar a trava | `vermelho.log`: código do pai `4e5c285` + o teste do `5459b65`, 0/1, evento 232 ms antes da liberação da trava | `5459b65` (10/10/2026): `clock_timestamp()` lido com a linha já travada | `verde.log`: 1/1 |

Os casos 3 e 4 foram reproduzidos em 24/11 em worktrees descartáveis, com o código antigo do próprio histórico do git, não com código alterado à mão.
