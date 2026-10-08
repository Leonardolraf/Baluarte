# Plano do backend — Baluarte

> Como o backend vai ser construído, do que existe hoje até o alvo do DRS. Fonte de verdade dos requisitos: `DRS_Final_v4` (Obsidian) e a wiki numerada em `Teste de Software/`. Em conflito, o DRS prevalece.

## 1. Onde estamos (inventário honesto)

O backend já roda de verdade: Node + Express + TypeScript + **Prisma sobre PostgreSQL** (desde 07/10/2026; antes SQLite), JWT **HS256** + bcrypt, RBAC por middleware relendo o perfil do banco, trilha em `AuditLog`, e uma superfície REST que sustenta os dois frontends e as suítes da N2 AT1.

| Camada | Arquivo | Estado |
|---|---|---|
| App/HTTP | `src/http/` | app (CORS restrito, helmet, JSON 64kb, envelope de erro 400/413, 404), roteador, middlewares `exigeToken`/`exigePerfil` (relê o usuário no banco), `ErroNegocio` + `wrap` |
| Plataforma | `src/platform/` | Prisma, e-mail (SMTP/Mailpit/memória), tokens de link (SHA-256) |
| Módulos | `src/modules/` | auth, users, departments, assets, scanner, reports, campaigns, training, dashboard, notifications, audit — cada um com `routes` → `service` → `repository` (Fase 0 concluída em 08/10/2026, B01) |
| Dados | `prisma/schema.prisma` | User, Asset, Scan, Finding, Campaign, CampaignEvent, AuditLog, NotificationPreference, PasswordResetToken |
| Testes | `tests/` | 38 de integração + 106 de pentest, banco isolado por arquivo |

**O que é simulado no servidor (escopo honesto atual):** o scanner OWASP (`POST /scans` sorteia achados de um catálogo) e o disparo de phishing (a campanha nasce `AGENDADA`, o rastreamento vem do `seed:demo`). Nenhum ataque real, nenhum e-mail enviado.

## 2. Alvo do DRS (para onde vamos)

| Eixo | Hoje | Alvo DRS |
|---|---|---|
| Banco | **PostgreSQL** + Prisma, migrations versionadas — feito em 07/10/2026 | **PostgreSQL** + Prisma (migrations versionadas) |
| Token JWT | HS256 (segredo simétrico) | **RS256** (par de chaves; assina com privada, verifica com pública) |
| E-mail | nenhum (token no log) | **MailHog** (dev) / **SendGrid** (prod): bloqueio de conta, link de reset, disparo de phishing |
| Scanner | sorteio de catálogo | motor de varredura com **progresso em tempo real**, uma por ativo (RN-003), fila/worker |
| Campanhas | rastreamento semeado | ciclo real: agenda → dispara (e-mail interno) → rastreia clique/abertura → treino pós-clique |
| Transporte | HTTP no Compose | **Nginx com TLS 1.3** (RNF-01), HTTP→HTTPS |
| Módulos | 3 arquivos de rota | domínios `auth, users, assets, scanner, reports, campaigns, training, dashboard, audit` |
| Extras | — | exportar PDF (RF13), histórico evolutivo (RF12), alertas (RF14), API externa (RF15) |

## 3. O gap por requisito

Já atendidos (total ou quase): RF01 (falta e-mail de bloqueio), RF02, RF03, RF04, RF06, RF08, RF09, RF11, e as regras RN-001/002/004/006/007/008. Pendentes ou parciais:

- **RF05 Varredura** — falta progresso em tempo real, estados de scan (`EM_ANDAMENTO`), trava de concorrência por ativo (RN-003) e o "motor" com verificações OWASP nomeadas.
- **RF07 Phishing** — falta o disparo real (e-mail interno via MailHog) e o rastreamento por pixel/link (endpoints públicos de abertura e clique).
- **RF10 Remediação** — o campo existe no domínio; falta conteúdo estruturado por categoria OWASP.
- **RF12 Histórico**, **RF13 PDF**, **RF14 Alertas**, **RF15 API externa** — a construir.
- **RNF-01** TLS, **RNF-02** retenção/imutabilidade de log, **RNF-04** metas de desempenho, **RNF-06** LGPD (exclusão em 24h), **RNF-08** cobertura ≥ 70% + SonarQube.

## 4. Arquitetura-alvo (3 camadas, modularização por domínio)

```
src/
  http/            app, middlewares (auth, rbac, rate-limit, erro), server
  modules/
    auth/          login, sessão, reset, política de senha
    users/         CRUD + RBAC + regra do último admin
    assets/        cadastro, status, host
    scanner/       varredura (serviço + fila/worker), catálogo OWASP, progresso
    reports/       findings, remediação, exportação PDF, histórico evolutivo
    campaigns/     ciclo de vida, disparo (e-mail), rastreamento, funil
    training/      conteúdo por template, conclusão
    dashboard/     agregações de risco técnico + humano
    audit/         trilha imutável, consulta pelo Administrador
    notifications/ preferências + alertas + envio de e-mail (MailHog/SendGrid)
  platform/        prisma client, config (env validada), logger, email, jobs
```

Cada módulo: `routes` (Express) → `service` (regra de negócio) → `repository` (Prisma). A regra de negócio sai dos handlers (hoje concentrada em `routes/*.ts`) para os serviços, testáveis isoladamente. O contrato N2 AT1 e as mensagens de `util.ts` **não mudam** — a modularização preserva a superfície pública.

## 5. Fases (ordenadas por dependência e risco)

**Fase 0 — Fundação sem mudar comportamento.** Extrair serviços/repositories dos três arquivos de rota, sem tocar rotas nem mensagens; validar entrada com um schema (zod) na borda; consolidar config de ambiente validada. *Rede de segurança:* os testes atuais do backend (166 em 07/10/2026) mais Newman/Robot devem continuar verdes a cada passo.

**Fase 1 — PostgreSQL.** Trocar o provider do Prisma para `postgresql`, gerar migrations, subir o Postgres no Compose (rede interna, volume, sem porta externa). O código Prisma é quase agnóstico; o risco está em tipos de coluna e no seed. Rodar a suíte inteira contra Postgres em CI.

**Fase 2 — JWT RS256 + e-mail.** Par de chaves (privada só no backend, pública para verificação); MailHog no Compose para dev; abstração `email` com driver MailHog/SendGrid. Ligar: e-mail de bloqueio (RF01), link de reset por e-mail em vez do log, base para o phishing.

**Fase 3 — Scanner real-simulado (RF05).** Estados de scan, trava por ativo (RN-003), worker assíncrono com progresso consultável (polling ou SSE), catálogo OWASP nomeado por verificação, notificação ao concluir. Meta de 60s/50 endpoints (RNF-04).

**Fase 4 — Campanhas de verdade (RF07/RF08/RF11).** Agendador que dispara na data; e-mail interno (só `@empresa.com`, RN-004) via MailHog; endpoints públicos de abertura (pixel) e clique (redireciona ao treino contextual, RN-005); funil real a partir dos eventos. Dado individual restrito a Admin/Analista (RN-006, já garantido).

**Fase 5 — Relatórios e observabilidade (RF10/RF12/RF13/RF14).** Remediação estruturada; histórico evolutivo do risco por ativo; exportação PDF; alertas automáticos; logger estruturado, healthcheck já existente, métricas.

**Fase 6 — Hardening de produção.** TLS 1.3 no Nginx (RNF-01); retenção/imutabilidade do AuditLog (RNF-02); fluxo de exclusão LGPD em 24h (RNF-06); cobertura ≥ 70% e SonarQube (RNF-08); rate-limit por IP além do por conta; cabeçalhos de segurança na API.

## 6. Riscos e decisões em aberto

- **Contrato N2 AT1 é intocável.** Toda fase roda Newman (70) e Robot (29) antes de seguir. A modularização não pode mudar mensagem, código de erro nem status.
- **Escopo real vs. simulado.** Varredura e phishing continuam simulados no servidor (não há alvo real nem envio externo). O "real" aqui é o *ciclo de vida e o rastreamento*, não a execução de um ataque — coerente com o escopo honesto do projeto.
- **SQLite → Postgres** pode expor diferenças de comportamento (case-sensitivity já tratada em código; conferir datas e transações).
- **Chaves RS256 e credenciais SendGrid** são segredos — `.env` fora do git, nunca versionados (lição OSINT do projeto).
- **Já corrigido pelos pentests** (entra como base da Fase 0): coerção de query, validação de tipo, corpo grande, RBAC no payload.

## 7. Próximo passo concreto

Fase 0 — modularização **concluída em 08/10/2026 (B01)**: as rotas saíram de `routes/{api,read,manage}.ts` para `modules/<domínio>/{routes,service,repository}.ts`, sem mudar rota, mensagem nem código de erro (backend 289/289, Newman 70/70). Falta da Fase 0 a validação com zod na borda (B09), que entra nas rotas dos módulos.
