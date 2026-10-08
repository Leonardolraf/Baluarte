# Deploy da API no Railway

Roteiro para publicar o backend no Railway (plano **Hobby**) com um PostgreSQL próprio, deixando de depender só do Supabase. Escrito em 08/10/2026, antes da assinatura do plano: tudo abaixo é executável assim que a conta tiver um plano ativo.

## Por que Railway e o que muda

| Item | Hoje (demo) | No Railway |
|---|---|---|
| API | Função serverless na Vercel (`baluarte-api`) | Contêiner Docker sempre no ar (sem dormir) |
| Banco | Supabase (Postgres hospedado) | Postgres do próprio projeto Railway, rede privada |
| E-mail | SMTP do Gmail | **API do Brevo** (`BREVO_API_KEY`): o Railway bloqueia SMTP (25/465/587) no Hobby |
| Segredo do JWT | Variável na Vercel | Gerado pelo `docker-entrypoint.sh` dentro do contêiner (não sai dele; um deploy novo encerra as sessões abertas) |

Comparação feita em 08/10/2026: o Render gratuito dorme após 15 min sem acesso (cerca de 1 min para acordar), o Postgres grátis expira 30 dias após criado e não tem backup, e também bloqueia SMTP. O Railway Hobby (US$ 5/mês, com US$ 5 de uso incluídos) mantém a API no ar e o banco não expira.

## 1. Projeto e banco

1. Criar o projeto `baluarte` no workspace do Leo.
2. Adicionar o PostgreSQL pelo template oficial (`postgres`). As credenciais são geradas pelo Railway; ninguém digita senha.

## 2. Serviço da API

Criar o serviço `api` com a fonte `Leonardolraf/Baluarte`, branch `main`, e as definições:

| Definição | Valor | Por quê |
|---|---|---|
| Root directory | `/backend` | O repositório é um monorepo |
| Builder | Dockerfile (`backend/Dockerfile`) | Mesma imagem do Docker Compose local |
| Healthcheck path | `/health` | Rota pública que não toca no banco |
| Healthcheck timeout | `120` s | A primeira subida aplica as migrations antes de ouvir a porta |
| Restart policy | `ON_FAILURE`, 5 tentativas | |
| Região | a mesma do Postgres | Latência por consulta (lição do PR #7: API e banco em regiões diferentes custavam ~2 s por tela) |
| Sleep (serverless) | desligado | A demo não pode levar 1 min para acordar |

O `PORT` é injetado pelo Railway; o servidor já lê `process.env.PORT`.

## 3. Variáveis do serviço `api`

| Variável | Valor | Quem define |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Claude, pelo plugin (referência, não é segredo copiado) |
| `DIRECT_URL` | `${{Postgres.DATABASE_URL}}` | idem (sem pooler, a URL direta é a mesma) |
| `NODE_ENV` | `production` | idem |
| `SEED_CONTRATO` | `0` | idem: **não** criar as contas com senha pública do README |
| `SEED_DEMO` | `0` | idem: os dados vêm da migração do Supabase (passo 5) |
| `FRONTEND_URL` | `https://baluarte-security.vercel.app` | idem: base dos links nos e-mails |
| `CORS_ORIGIN` | `https://baluarte-security.vercel.app` | idem |
| `EMAIL_REMETENTE` | `Baluarte <leofilhoamorim@gmail.com>` | idem: remetente verificado no Brevo |
| `BREVO_API_KEY` | chave da API do Brevo | **o Leo, no painel do Railway** (nunca no chat nem no repositório) |

Sem `BREVO_API_KEY`, a API sobe normalmente, mas em produção nenhum e-mail sai (convite e "esqueci a senha" respondem como sempre, sem entregar).

## 4. Domínio

Gerar o domínio `*.up.railway.app` do serviço `api`. A API fica em `https://<domínio>/api` e o health em `https://<domínio>/health`.

## 5. Dados: migrar do Supabase

O Postgres novo nasce vazio (com `SEED_CONTRATO=0` e `SEED_DEMO=0`). Para manter as contas reais (inclusive a do Leo) e os dados da demo:

1. `pg_dump` do Supabase **só dos dados** (`--data-only`, sem a tabela `_prisma_migrations`), pela conexão de sessão (porta 5432).
2. O primeiro deploy da API já aplicou as migrations no Postgres do Railway (`migrate deploy` no entrypoint), então o schema existe.
3. `pg_restore`/`psql` dos dados no Postgres do Railway pela URL pública (TCP proxy) ou pelo `railway connect`.
4. Conferir contagens por tabela nos dois lados.

Quem tem as credenciais do Supabase é a sessão que publicou a demo; a conexão do Railway sai do plugin. Nenhuma senha passa pelo chat.

## 6. Frontend

Na Vercel, trocar `VITE_API_BASE_URL` do projeto `baluarte` para `https://<domínio do Railway>/api` e redeployar. A API da Vercel (`baluarte-api`) pode ficar no ar como reserva até o Railway estar validado.

## 7. Verificação

- `GET /health` 200 e `GET /api/findings/classificacao?cvss=9.8` 200 no domínio do Railway.
- Login com uma conta real, criar usuário (convite chega pelo Brevo), "esqueci a senha".
- Tempo de resposta das telas comparável ao da Vercel em `pdx1`.
