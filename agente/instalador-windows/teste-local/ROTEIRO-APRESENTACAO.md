# Instalador do agente na apresentação (25/11/2026)

## Onde rodar: nesta máquina (recomendado)

**Apresentar do mesmo PC onde o fluxo foi testado.** Tudo o que o fluxo real precisa já está aqui e
funcionando: o Docker, o worktree do Backend (`feat/vinculo-agente`, que **não está no GitHub**), os
certificados, as imagens construídas e o `.exe` com a CA certa embutida.

O notebook é o caminho arriscado, porque precisaria de tudo isso montado de novo na véspera:

- Docker Desktop (com WSL2) instalado e funcionando;
- as **duas** branches, `feat/vinculo-agente` e `feat/instalador-exe-agente`. Nenhuma das duas está
  no remoto, então seria push das duas ou cópia manual;
- construir a imagem do backend (1,1 GB, com internet);
- copiar `certs/` deste PC, **sem gerar de novo**: CA nova faria o `.exe` desconfiar do servidor, e a
  falha apareceria como erro de TLS, longe da causa.

Se for obrigatório usar o notebook, siga o passo a passo do fim deste arquivo e **ensaie hoje,
lá**. Ensaiar aqui não vale para o notebook.

Tudo fica em `127.0.0.1` (ver `compose.local.yml`): o notebook não alcançaria o servidor deste PC
pela rede, e é de propósito. Servidor e agente rodam na mesma máquina.

## Preparo, antes de apresentar (cerca de 10 min)

No worktree do Backend (`C:\Users\Leo\Desktop\Baluarte\Baluarte-vinculo`):

```powershell
$O = 'C:\Users\Leo\Desktop\Baluarte\Baluarte-instalador\agente\instalador-windows\teste-local'
docker compose -p baluarte-vinculo --env-file ..\Baluarte\.env -f docker-compose.yml -f "$O\compose.local.yml" down -v
$env:SEED_CONTRATO = '1'; $env:SEED_DEMO = '1'
docker compose -p baluarte-vinculo --env-file ..\Baluarte\.env -f docker-compose.yml -f "$O\compose.local.yml" up -d db backend app
```

**O `down -v` é necessário.** A estação é identificada pelo UUID do hardware, e os testes já
inscreveram esta máquina. Sem zerar, a instalação ao vivo não faria a estação "nascer": ela só
atualizaria a que já existe e trocaria o nome dela. O `-p baluarte-vinculo` apaga só os volumes
deste ambiente de teste, nunca o banco `baluarte` do projeto principal.

Depois confira:

- `https://localhost:8443` abre o painel (admin@empresa.com, senha do seed de contrato) e
  Estações está **vazia**;
- **o agente desinstalado** (obrigatório, medido em 24/11): `agente\desinstalar-agente.ps1` como
  Administrador, e depois `Test-Path 'C:\Program Files\osquery'` deve dar `False`. Instalar por cima
  de um ensaio **não usa o código novo**: o `osquery.db` guarda a chave de nó antiga, o osquery
  nem tenta se inscrever de novo e o código fica válido, sem uso. A tela diria "inscrita" (o agente
  está mesmo inscrito, mas com a chave do ensaio) e o passo 4 (reuso) daria `200` em vez de `401`.
  O desinstalador apaga a pasta inteira, com o `osquery.db`;
- a pasta de destino no wizard: `C:\Program Files\Baluarte\Agente`. O wizard sugere a pasta da
  instalação anterior, então confira.

## Roteiro (cerca de 2 min: a instalação sozinha leva perto de 1)

1. **Emitir o código.** Num PowerShell, na pasta `teste-local`:
   `.\vinculo-demo.ps1 -Acao Emitir`. Ele pede a senha do Administrador e mostra
   `BLT-XXXX-XXXX-XXXX`, válido por 24 h e de uso único.
   *Fala:* "o administrador emite o código já com os dados do ativo; o servidor guarda só o hash."
   (Ainda não há tela no painel para isso: o endpoint existe, a tela não. O script faz a mesma
   chamada que a tela faria.)
2. **Instalar.** Rodar `saida\InstaladorAgenteBaluarte-0.1.0.exe`. No SmartScreen, clique em
   "Mais informações" e depois em "Executar assim mesmo" (o `.exe` não é assinado; é protótipo).
   Aceite o UAC. Na página do servidor, `localhost:8443`, e cole o código.
   *Fala, durante a instalação:* "o instalador não carrega segredo nenhum e não fala com a rede: o
   código É o segredo de inscrição desta máquina. No fim ele confere de verdade se o servidor
   aceitou, porque serviço rodando não quer dizer estação inscrita."
3. **Resultado.** A tela final diz "a estação foi inscrita no Baluarte". No painel, em Estações,
   a máquina aparece vinculada ao ativo com o nome emitido no passo 1.
4. **Reuso.** `.\vinculo-demo.ps1 -Acao Reusar` e cole o **mesmo** código. A resposta é
   `HTTP 401 SEGREDO_INVALIDO`. *Fala:* "uso único: quem copiar o código depois não inscreve outra
   máquina."

## Plano B (sem instalar nada)

Se a instalação der errado na hora, ou se não houver tempo:

- `saida\InstaladorAgenteBaluarte-0.1.0-DEMONSTRACAO.exe`: as mesmas 7 páginas, sem elevação e
  sem instalar nada;
- e o vínculo direto pelo script: `Emitir`, depois uma inscrição com o código (o osquery faria
  isso) e por fim `Reusar` com o mesmo código, que mostra `200` e depois `401`.

A tela final do `.exe` real tem quatro mensagens, e as quatro dizem a verdade. "Recusado" significa
código expirado ou já usado. "Não confirmada" significa servidor inacessível ou indeterminado:
confira se o compose está de pé e veja o diário (`C:\Program Files\Baluarte\Agente\instalacao.log`).

## Notebook: passo a passo (só se for obrigatório)

Testável hoje, **no notebook**:

1. Docker Desktop instalado e funcionando: `docker info` responde.
2. Repositório clonado, e as duas branches no notebook (push das duas com ok do Leo, ou cópia).
3. Copiar `Baluarte\certs\ca.crt` e `Baluarte\certs\servidor\` deste PC para o mesmo lugar no
   clone do notebook. O certificado do servidor já vale para `localhost` em qualquer máquina.
4. `.env` da raiz com `POSTGRES_PASSWORD` (qualquer valor novo, porque o banco nasce lá).
5. No checkout de `feat/vinculo-agente`: o mesmo `up` do preparo acima (`--build` na primeira vez).
6. Copiar `saida\InstaladorAgenteBaluarte-0.1.0.exe` deste PC: ele já leva a CA certa.
7. Ensaiar o roteiro inteiro uma vez, lá, e depois repetir o preparo (`down -v` + `up`).
