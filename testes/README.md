# Testes — Baluarte (Teste de Software, N2 AT1)

Artefatos dos testes do projeto. Como o sistema Baluarte ainda não tem backend/frontend implementados, cada teste roda contra um **stub** local que reproduz o contrato/validações da funcionalidade, permitindo execução e evidências reais. A documentação (modelagem, instruções e relatórios) está na **Wiki** do repositório.

## `api/` — Testes de API (Postman / Newman)

Dois testes de API por Partição de Equivalência. Stub em `http://localhost:8080`.

- `stub-api/server.js` — stub Node (sem dependências) de `POST /api/login` e `POST /api/scans`.
- `postman/` — coleção + environment (importar no Postman, ou rodar com `newman`).
- `evidencias/` — relatório do Newman.

```
node stub-api/server.js
newman run postman/Baluarte-N2AT1.postman_collection.json -e postman/Baluarte-local.postman_environment.json
```

Wiki: **[12] Teste de API — Login** e **[13] Teste de API — Varredura**.

## `ui/` — Testes de interface web (Robot Framework + SeleniumLibrary)

Dois testes automatizados de interface de usuário. Stub das telas servido em `http://localhost:3000`.

- `cadastro_usuario/` — Tabela de Decisão (formulário de cadastro). `.robot` + `stub/` + `resultados/` (report/log/output + screenshots).
- `campanha_phishing/` — Partição de Equivalência (criação de campanha). Idem.

```
# servir as telas (stub)
python -m http.server 3000           # dentro de ui/<teste>/stub
# rodar a suíte
robot --outputdir resultados ui/cadastro_usuario/cadastro_usuario.robot
```

Wiki: **[14] Teste de UI — Cadastro de Usuário** e **[15] Teste de UI — Campanha de Phishing**.

## Ambiente

Robot Framework 7.4.2 · SeleniumLibrary 6.9.0 (Selenium 4.45, Chrome headless) · Node 24 · Python 3.14.
