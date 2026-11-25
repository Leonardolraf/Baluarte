# Métodos de detecção do Baluarte (cartão #8)

O que o produto detecta, como detecta, onde está no código, o limite de cada método e o que daria
para melhorar. Cada afirmação cita o arquivo de onde saiu; números só aparecem quando estão no
código ou num documento medido. Estado da `main` em `f7308d3` (24/11/2026).

| Método | Real ou simulado | Fonte de verdade |
|---|---|---|
| 1. Varredura web OWASP | **simulado** | `backend/src/services/cicloVarredura.service.ts`, `backend/src/models/catalogoAchado.model.ts` |
| 2. Inventário das estações × OSV e NVD | **real** | `backend/src/services/cruzamento.service.ts`, `backend/src/models/cruzamento.model.ts`, `backend/src/config/osv.ts`, `backend/src/config/nvd.ts` |
| 3. Análise de arquivos (ClamAV, YARA, VirusTotal) | **real** | `backend/src/services/analiseArquivo.service.ts`, `backend/src/config/antivirus.ts`, `antivirus/regras/`, `backend/src/services/segundaOpiniao.service.ts`, `docs/CLAMD-LIMITES.md` |
| 4. Phishing simulado | **real no envio, simulado no conteúdo** (decisão do projeto) | `backend/src/services/campanhaEmail.service.ts` |
| 5. Inscrição do agente por código de vínculo | **real** | `backend/src/services/vinculoEstacao.service.ts`, `backend/src/models/vinculoEstacao.model.ts`, `backend/src/services/agente.service.ts` |

Regra que vale para todos os métodos: ausência de dado não é ausência de risco. Base fora do ar,
consulta pendente ou arquivo que o antivírus não leu inteiro nunca viram "limpo" (seções 2 e 3).

---

## 1. Varredura web OWASP: simulada

**Como funciona.**
- Máquina de estados avaliada na leitura, sem worker nem timer, porque a API também roda como
  função serverless, que congela depois de responder (`cicloVarredura.service.ts`, comentário do
  topo). O status sai do tempo decorrido desde `criadoEm`: `EM_FILA` até `TEMPO_EM_FILA_MS = 5_000`,
  `EM_ANDAMENTO` até `DURACAO_VARREDURA_MS = 20_000`, depois `CONCLUIDA` (`statusPorTempo`).
- O progresso e as etapas ("Mapeando superfície", "Testando injeção", "Testando autenticação",
  "Gerando relatório") são divididos por igual no tempo de andamento (`ETAPAS_ANDAMENTO`,
  `progressoPorTempo`). São rótulos de tempo: nenhum teste corre por trás deles.
- Na conclusão, `gerarFindings()` sorteia de 2 a 4 tipos distintos (`2 + randomInt(3)`) do
  catálogo `CATALOGO_ACHADOS`, que tem 10 tipos em 6 categorias do OWASP Top 10 2021 (A01, A02, A03,
  A05, A06 e A07) (`catalogoAchado.model.ts`).
- A nota não é digitada: `dadosAchado()` calcula o CVSS 3.1 a partir do vetor (`notaCvss`) e a
  severidade sai da nota (`faixaCvss`); tipo com vetor, CWE ou CVE inválido derruba a carga do
  catálogo com erro (`catalogoAchado.model.ts`, `services/cvss.service.ts`).
- Uma varredura por vez no mesmo ativo (`409 VARREDURA_EM_ANDAMENTO`) e ativo inativo recusado
  (`422 ATIVO_INATIVO`) (`varredura.service.ts`).

**Limite honesto.**
- Nenhum pacote sai para o ativo: o host cadastrado não é contatado, e os achados não têm relação
  com ele. O mesmo ativo pode receber "injeção SQL" numa varredura e não na seguinte.
- A evidência de cada achado é texto fixo do catálogo (por exemplo, `GET /api/admin/users -> 200
  com token de Colaborador.`), não uma requisição registrada (`catalogoAchado.model.ts`).
- Cobre só 6 das 10 categorias do Top 10 2021, e só os 10 tipos do catálogo.
- A duração (20 s) é constante e não depende do tamanho do alvo.

**Melhoria possível.** Modo real ao lado do simulado (cartão W01, "Varredura web real com OWASP ZAP
e Nuclei", no backlog do projeto; decisão de 02/10/2026 com o OWASP Juice Shop como alvo de
laboratório, registrada no `CLAUDE.md` da pasta do projeto). O próprio código reserva o worker
de verdade para esse modo (`cicloVarredura.service.ts`: "O worker de verdade fica para o modo real
(W01/W09)"). Precisaria de execução fora da função serverless e de autorização explícita do dono
de cada alvo.

**Testes.** `backend/tests/varredura.test.ts`, `backend/tests/unidade/progresso-varredura.test.ts`,
`backend/tests/unidade/cvss-catalogo.test.ts`.

---

## 2. Inventário das estações × OSV e NVD: real

**Como funciona.**
- Coleta: o osquery da estação manda, como snapshot, programas instalados (`programs` no Windows,
  `deb_packages` e `rpm_packages` no Linux, `apps` no macOS), versão do SO e portas em escuta;
  a API guarda só o inventário mais recente por estação (`README.md`, seção "Agente de estação";
  consultas fixas em `backend/src/models/agente.model.ts`).
- Linux: `POST /v1/querybatch` do OSV com o ecossistema tirado do SO da estação (`Debian:<versão>`,
  `Ubuntu:<aa.mm>[:LTS]`, `AlmaLinux:<versão>`, `Rocky Linux:<versão>`) e, no deb, pelo pacote-fonte;
  depois `GET /v1/vulns/{id}` para CVE, vetor e versão corrigida (`config/osv.ts`,
  `ecossistemaOsv` em `models/cruzamento.model.ts`).
- Windows: só os programas da tabela `backend/src/models/tabelaCpe.model.ts` (21 programas:
  Chrome, Edge, Firefox, Firefox ESR, Thunderbird, Acrobat Reader, 7-Zip, WinRAR, VLC, Notepad++,
  PuTTY, WinSCP, FileZilla, Wireshark, KeePass, Git, Node.js, LibreOffice, TeamViewer, AnyDesk e
  OpenVPN) viram CPE 2.3 e são consultados no NVD por `cpeName` (`config/nvd.ts`).
- Achado: CVE com vetor CVSS 3.x vira achado `A06:2021` da estação, com nota calculada do vetor;
  sem vetor em nenhuma base, conta em `semCvss` e não vira achado (`README.md`, seção "Cruzamento
  com bases públicas"; `cruzamento.service.ts`). Estação + CVE + programa não se repete.

**Regras que evitam falso "limpo" e falso alarme** (todas em `cruzamento.service.ts` salvo
indicação):
- **DT17, só CVE com correção publicada:** vira achado só o CVE que tem versão corrigida
  publicada para o pacote ou produto instalado (no NVD, `versionEndExcluding`); o resto conta em
  `semCorrecao`.
- **DT17, só verificação completa:** com consulta pendente (orçamento do NVD) ou base sem
  resposta, nada é gravado, a data da verificação não muda e a resposta sai com
  `completa: false`; o consultado fica em cache para a próxima rodada.
- **DT21, plataforma:** a correção só conta se a configuração do CVE vale na plataforma da
  estação ("Chrome no Android" não afeta o Chrome do Windows); o que sai por isso conta em
  `outraPlataforma`.
- **DT22, 404 do NVD é falha:** o NVD responde 200 com lista vazia para produto sem CVE; 404 só
  vem de requisição recusada (chave inválida ou parâmetro malformado), então vira
  `BaseIndisponivel` e nunca "nenhuma vulnerabilidade" (`config/nvd.ts`). No OSV, 404 em
  `GET /v1/vulns/{id}` significa "registro desconhecido" (`config/osv.ts`).
- **B36 e DT23, fechamento automático:** numa verificação completa, achado aberto cujo CVE +
  programa nenhuma base devolveu mais passa a "Resolvida", com evento sem usuário e auditoria.
  O que só saiu por regra (sem correção, outra plataforma) não é fechado; "Risco aceito" não é
  tocado; nada reabre sozinho. O motivo fica separado: `RESOLVER_ACHADOS_ESTACAO` (programa ainda
  no inventário, versão fora da faixa) ou `RESOLVER_ACHADOS_FORA_DO_INVENTARIO` (a coleta não vê
  mais o programa; a auditoria não afirma a remoção).

**Limite honesto.**
- **Windows depende de tabela manual:** programa fora dos 21 da tabela de CPE não é consultado
  (`tabelaCpe.model.ts`: "nao ha como saber o CPE sem adivinhar"). Um programa vulnerável fora
  da lista não gera achado e só aparece em `programasSemCobertura`.
- **Sem cobertura:** RHEL, SUSE e macOS (`apps`) não são cruzados (`ecossistemaOsv` devolve `null`;
  `README.md`, tabela do B14).
- **Orçamento do NVD sem chave:** 5 consultas por verificação sem `NVD_API_KEY` e 40 com ela;
  no OSV, até 300 registros detalhados por verificação (`LIMITE_NVD_SEM_CHAVE`,
  `LIMITE_NVD_COM_CHAVE` e `LIMITE_DETALHES_OSV` em `models/cruzamento.model.ts`). Estação Windows
  com muitos programas da tabela precisa de várias verificações para ficar completa, e até lá não
  mostra nada (consequência do DT17).
- **Só o que o SO registra:** a coleta lê a lista de programas instalados; executável portátil
  não aparece (`cruzamento.service.ts`, comentário do DT23).
- **Só CVE com correção:** vulnerabilidade sem correção publicada (zero-day, produto abandonado)
  não vira achado por decisão do DT17; fica só na contagem `semCorrecao`.
- **Atraso das bases:** cache de 24 h por padrão (`VULN_CACHE_HORAS`, `README.md`) e dependência
  do que OSV e NVD publicam.
- **Verificação automática só em servidor de longa duração:** na Vercel fica desligada, porque a
  função congela depois de responder (`cruzamento.service.ts`, `CRUZAMENTO_AUTOMATICO`).

**Melhorias possíveis.** Gerar a tabela de CPE a partir do dicionário oficial do NVD em vez de
mantê-la à mão; usar `NVD_API_KEY` na demonstração (40 em vez de 5 consultas); cobrir RHEL/SUSE
pelo CPE da distribuição; mostrar `semCorrecao` como risco informativo na tela, para o DT17 não
esconder CVE sem correção; procurar malware nas estações com o agente (cartão W02 do backlog).

**Testes.** `backend/tests/cruzamento.test.ts` (inclui "DT21: CVE "no Android" ... não vira achado
no Windows", "DT22: NVD respondendo 404 ... é FALHA da base, nunca "estação limpa"", "sem chave do
NVD, no máximo 5 consultas por verificação", "DT23: programa que sumiu do inventário fecha com
motivo próprio", "verificação incompleta não fecha nada"), `backend/tests/unidade/cruzamento.test.ts`,
`backend/tests/estacao.test.ts`. Validação com o osqueryd real num contêiner:
`scripts/validar-agente-docker.sh` (`testes/qualidade/metodos-verificacao.md`, seção 13).

---

## 3. Análise de arquivos: ClamAV, YARA próprio e VirusTotal (real)

**Como funciona.**
- **ClamAV por INSTREAM:** o arquivo do multipart passa em fluxo pela API até o clamd, com SHA-256
  e tamanho calculados no caminho, e é descartado; a API não grava em disco nem devolve o arquivo
  (`analiseArquivo.service.ts`, `config/antivirus.ts`).
- **250 MB:** `LIMITE_ARQUIVO_MB = 250` (MB de 1024 × 1024 bytes), acompanhado por busboy, Nginx
  (`client_max_body_size 251m` só na rota de análise) e clamd (`StreamMaxLength 251M`)
  (`models/analiseArquivo.model.ts`, `README.md`, `docs/CLAMD-LIMITES.md` item 1).
- **Limites do clamd, regra "só a cota corta, e ela avisa":** `MaxScanSize 1000M`, `MaxFileSize`,
  `MaxHTMLNormalize`, `MaxScriptNormalize` e `PCREMaxFileSize` em 1001M, `MaxScanTime 240000` e
  `AlertExceedsMax yes` (`docs/CLAMD-LIMITES.md`, item 1). Com o alerta, o que passa de um limite
  volta `Heuristics.Limits.Exceeded.<Limite>` e conta como ameaça por precaução
  (`ehLimiteExcedido` em `models/analiseArquivo.model.ts`). Estouro do `StreamMaxLength`, resposta
  fora do protocolo ou conexão caída viram `503 ANTIVIRUS_INDISPONIVEL`, sem registro
  (`docs/CLAMD-LIMITES.md`, item 3).
- **Zip64 (DT27):** o ClamAV 1.5.4 responde "OK" sem ler a entrada de zip com `0xFFFFFFFF` no
  tamanho do cabeçalho local e sem descritor de dados; a API procura essa forma no próprio fluxo
  (`backend/src/utils/detectorZip64.ts`), inclusive aninhada até 17 níveis e 1000 MiB
  descomprimidos, e o veredito vira `Baluarte.Zip64.NaoAnalisavel` (ou
  `Baluarte.Zip64.VerificacaoIncompleta` se os tetos estourarem) (`models/analiseArquivo.model.ts`,
  `docs/CLAMD-LIMITES.md` item 4).
- **Regras YARA próprias (B23):** 5 regras em 4 arquivos de `antivirus/regras/`:
  `BaluarteMarcadorTeste` (marcador inofensivo de teste), `BaluarteMacroSuspeita` (macro VBA de
  autoexecução que chama o sistema), `BaluartePowerShellBaixaExecuta` (baixa e executa ou
  `-EncodedCommand`), `BaluarteLnkPayloadBase64` e `BaluarteHtmlPayloadBase64` (HTML smuggling).
  Detecção `YARA.Baluarte*.UNOFFICIAL` ganha o rótulo "regra própria do Baluarte"
  (`ehRegraPropria`); `antivirus/regras/baluarte_html_cru.cfg` religa a varredura crua de HTML
  (DT26, `docs/CLAMD-LIMITES.md` item 5).
- **Segunda opinião do VirusTotal (B20):** depois do ClamAV, consulta **só pelo SHA-256**
  (`GET /files/{sha256}`); o arquivo nunca é enviado, o módulo nem conhece o endpoint de upload
  (`config/virustotal.ts`). Sem `VIRUSTOTAL_API_KEY` fica `DESLIGADO`; cota de 4 por minuto e 500
  por dia contada no banco; qualquer falha vira `INDISPONIVEL`; a segunda opinião nunca muda o
  veredito do ClamAV nem derruba a análise (`segundaOpiniao.service.ts`).

**Limite honesto.**
- **Só ameaça conhecida:** ClamAV e YARA casam assinatura e padrão. Malware novo, ofuscado ou
  feito sob medida passa. Por isso a mensagem de arquivo sem detecção é "Nenhuma ameaça conhecida
  encontrada" e o código proíbe dizer "arquivo seguro" (`MENSAGEM_LIMPO` em
  `models/analiseArquivo.model.ts`: "Nunca afirma 'arquivo seguro'").
- **Sem execução:** não há sandbox nem análise dinâmica; o arquivo nunca é aberto.
- **YARA no ClamAV é restrito:** sem módulos (`import "pe"`), sem regras `global`, sem variáveis
  externas, no máximo 64 strings por regra; regra com erro é descartada com um aviso e o clamd
  sobe sem ela, em silêncio para a API (`README.md`, seção "Antivírus e regras YARA próprias").
  As regras próprias são heurísticas: indicam padrão suspeito, não vírus catalogado, e podem dar
  falso positivo (macro legítima com `CreateObject`, por exemplo).
- **VirusTotal só conhece o que alguém já enviou:** arquivo inédito volta `DESCONHECIDO` (404),
  e sem a chave a camada fica desligada (`config/virustotal.ts`).
- **Dependência da imagem:** o critério do Zip64 depende do comportamento do ClamAV 1.5.4; a
  regressão `backend/tests/regressao-clamd-zip64.test.ts` acusa se a imagem mudar
  (`docs/CLAMD-LIMITES.md` item 4).
- **Precaução gera falso positivo:** arquivo que passa dos limites ou Zip64 não lido vira AMEAÇA
  mesmo se for legítimo (decisão registrada em `models/analiseArquivo.model.ts`).
- **Vercel (plano B):** a função serverless aceita corpo de 4,5 MB e não tem ClamAV; lá a análise
  responde 503 e o upload grande não funciona (`README.md`, "Limites que ficam").
- **Limites de uso:** 20 análises por usuário por hora e 2 simultâneas
  (`LIMITE_ANALISES_POR_HORA`, `LIMITE_ANALISES_SIMULTANEAS` em `models/analiseArquivo.model.ts`).

**Melhorias possíveis.** Sandbox de execução para os arquivos sem detecção; mais regras YARA com
corpus de falsos positivos; atualizar o ClamAV quando a correção do Cisco-Talos/clamav#1527 sair
e rodar a regressão do Zip64; mostrar na tela, junto do "Nenhuma ameaça conhecida", o que a
análise não cobre.

**Testes.** `backend/tests/analise-arquivo.test.ts`, `backend/tests/anexo-campanha.test.ts`,
`backend/tests/virustotal.test.ts`, `backend/tests/unidade/antivirus.test.ts`,
`backend/tests/unidade/config-clamd.test.ts`, `backend/tests/unidade/detector-zip64.test.ts`,
`backend/tests/unidade/regra-yara.test.ts`, `backend/tests/unidade/virustotal.test.ts`. Contra o
clamd real (só com `CLAMAV_HOST`): `backend/tests/aceitacao-clamd-real.test.ts` e
`backend/tests/regressao-clamd-zip64.test.ts`, com o roteiro e os resultados de 19/10/2026 em
`docs/CLAMD-LIMITES.md`.

---

## 4. Phishing simulado

**Como funciona.**
- `POST /campaigns` envia a cada destinatário interno um e-mail de um dos três templates
  (`urgencia`, `autoridade`, `curiosidade`; `TEMPLATES` em `backend/src/models/dominio.model.ts`).
  Só domínio interno ou endereço liberado em `DOMINIO_INTERNO` recebe (`dominio.model.ts`, DT19).
- O e-mail é só texto: sem anexo, sem HTML (logo, sem pixel de abertura), sem formulário e sem
  pedido de senha; os dois links apontam para o próprio frontend, `/t/<token>` (treinamento,
  registra o clique) e `/t/<token>/reportar` (registra o reporte); no banco fica só o hash do
  token; o rodapé identifica a simulação (`campanhaEmail.service.ts`, comentário do topo).
- O que se mede: clique, reporte e conclusão do treinamento por destinatário
  (`services/campanhaMetricas.service.ts`, `services/treinamento.service.ts`).

**Limite honesto** (`README.md`, "Limitações conhecidas"):
- **Sem captura de credenciais, por decisão do projeto:** não há página falsa de login; o
  Baluarte não mede "quem digitaria a senha", só quem clica e quem reporta.
- **Não é teste cego:** o rodapé diz que é simulação, então mede reconhecimento e hábito de
  reportar mais do que a queda num golpe realista.
- **Abertura não é medida:** sem pixel, a abertura só é registrada no clique ou no reporte.
- **Clique falso:** abrir `/t/<token>` registra o clique no carregamento; um antivírus de e-mail
  que pré-visite links conta clique que ninguém deu (por isso o reporte exige confirmação).
- **Envio síncrono** dentro do `POST /campaigns`, adequado a campanhas internas pequenas.

**Melhorias possíveis.** Distinguir o clique de robô (pré-visita) do clique humano; agendamento
e disparo automático de campanhas (W05) e resultado por departamento (W06), ambos no backlog.
Captura de credenciais simulada fica fora por decisão do projeto.

**Testes.** `backend/tests/campanha-email.test.ts` (inclui "o texto segue o template, é
identificado como simulação, não pede senha e não tem link externo"),
`backend/tests/aberturas-link.test.ts`, `backend/tests/treinamentos-consolidado.test.ts`.

---

## 5. Agente e inscrição por código de vínculo (#9)

**Como funciona.**
- O Administrador emite no painel um código de uso único `BLT-XXXX-XXXX-XXXX` (alfabeto de 32
  caracteres sem 0/O/1/I), com validade padrão de 24 h (`TTL_VINCULO_MS_PADRAO`); o banco guarda só
  o SHA-256 do código, e o código em claro só existe na resposta da emissão
  (`models/vinculoEstacao.model.ts`, `services/vinculoEstacao.service.ts`).
- O código **é** o `enroll_secret` daquela estação, porque o osquery não tem campo livre no enroll.
  No `POST /agentes/osquery/enroll`, segredo com prefixo `BLT-` é consumido de forma atômica
  (trava da linha e relógio lido depois da trava, lição do DT10) e o ativo-estação nasce com os
  metadados da emissão; desconhecido, expirado e já usado recebem o mesmo
  `401 SEGREDO_INVALIDO`, para não servir de oráculo (`agente.service.ts`, `CHANGELOG.md` de
  21/10/2026).
- Emissão, lista e revogação só para Administrador (`EMITIR_VINCULO_ESTACAO` e
  `REVOGAR_VINCULO_ESTACAO` na auditoria).
- Entrou na `main` pelo PR #79 (`f7308d3`). Segundo o cartão #9, está em produção desde
  24/11/2026; este documento não conferiu o servidor.

**Limite honesto.**
- **O segredo da organização continua valendo:** segredo sem o prefixo `BLT-` segue o caminho do
  `OSQUERY_ENROLL_SECRET`, compartilhado por todas as estações (`agente.service.ts`). Quem tiver
  esse segredo inscreve uma máquina qualquer sem passar pelo painel.
- **O código circula em claro até o uso:** quem o lê na tela ou no canal em que foi repassado e o
  usa primeiro, dentro das 24 h, inscreve a própria máquina; o dono legítimo recebe 401.
- **O inventário é o que o agente relata:** uma estação comprometida pode mentir para o osquery.
- O instalador `.exe` (Inno Setup) não está versionado neste repositório; aqui ficam
  `agente/instalar-agente.ps1` e `agente/instalar-agente.sh`.

**Melhorias possíveis.** Desligar o `OSQUERY_ENROLL_SECRET` quando todas as estações estiverem
inscritas por vínculo; prender o código a um `host` esperado na emissão e recusar a inscrição de
outro hostname; TTL menor para inscrição feita na hora.

**Testes.** `backend/tests/vinculo-estacao-enroll.test.ts` (uso único, expirado, desconhecido,
revogação e RBAC da emissão, da lista e da revogação), `backend/tests/unidade/vinculo-estacao.test.ts`,
`backend/tests/agente.test.ts`.

---

## Ver também

- `testes/qualidade/metodos-verificacao.md`: como cada parte é testada.
- `testes/qualidade/QUADRO-SEGURANCA.md`: tipo de ataque × status × evidência.
- `docs/CLAMD-LIMITES.md`: limites do clamd medidos e o roteiro de conferência na VM.
