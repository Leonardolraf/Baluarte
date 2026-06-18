# Evidências de execução — Testes de API (Newman/Postman)

Execução real da collection contra o stub local (`http://localhost:8080`) em **18/06/2026, 00:45:48**.
**35 requisições · 70 asserções · 0 falhas.**

## CT-L1 — CE1 credenciais válidas → 200

`POST http://localhost:8080/api/login` → **HTTP 200 OK** · ✅ Aprovado

**Request body:**

```json
{
  "email": "analista@empresa.com",
  "senha": "Senha@123"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 200
- ✓ Retorna token e perfil

**Evidência (Response Body — Postman):**

```json
{
  "status": "sucesso",
  "mensagem": "Autenticado com sucesso",
  "dados": {
    "token": "stub-token-analista-001",
    "idUsuario": "u-001",
    "email": "analista@empresa.com",
    "perfil": "Analista"
  }
}
```

---

## CT-L2 — CE2 e-mail mal formatado → 400

`POST http://localhost:8080/api/login` → **HTTP 400 Bad Request** · ✅ Aprovado

**Request body:**

```json
{
  "email": "analista-empresa.com",
  "senha": "Senha@123"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 400
- ✓ Código de erro EMAIL_INVALIDO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Formato de e-mail inválido",
  "codigoErro": "EMAIL_INVALIDO",
  "timestamp": "2026-06-18T03:45:48Z"
}
```

---

## CT-L3 — CE3 e-mail não cadastrado → 401

`POST http://localhost:8080/api/login` → **HTTP 401 Unauthorized** · ✅ Aprovado

**Request body:**

```json
{
  "email": "naoexiste@empresa.com",
  "senha": "Senha@123"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 401
- ✓ Código de erro CREDENCIAIS_INVALIDAS

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "E-mail ou senha inválidos",
  "codigoErro": "CREDENCIAIS_INVALIDAS",
  "timestamp": "2026-06-18T03:45:48Z"
}
```

---

## CT-L4 — CE4 e-mail vazio → 400

`POST http://localhost:8080/api/login` → **HTTP 400 Bad Request** · ✅ Aprovado

**Request body:**

```json
{
  "email": "",
  "senha": "Senha@123"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 400
- ✓ Código de erro EMAIL_OBRIGATORIO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "E-mail é obrigatório",
  "codigoErro": "EMAIL_OBRIGATORIO",
  "timestamp": "2026-06-18T03:45:48Z"
}
```

---

## CT-L5 — CE5 senha incorreta → 401

`POST http://localhost:8080/api/login` → **HTTP 401 Unauthorized** · ✅ Aprovado

**Request body:**

```json
{
  "email": "analista@empresa.com",
  "senha": "SenhaErrada"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 401
- ✓ Código de erro CREDENCIAIS_INVALIDAS

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "E-mail ou senha inválidos",
  "codigoErro": "CREDENCIAIS_INVALIDAS",
  "timestamp": "2026-06-18T03:45:48Z"
}
```

---

## CT-L6 — CE6 senha vazia → 400

`POST http://localhost:8080/api/login` → **HTTP 400 Bad Request** · ✅ Aprovado

**Request body:**

```json
{
  "email": "analista@empresa.com",
  "senha": ""
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 400
- ✓ Código de erro SENHA_OBRIGATORIA

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Senha é obrigatória",
  "codigoErro": "SENHA_OBRIGATORIA",
  "timestamp": "2026-06-18T03:45:48Z"
}
```

---

## CT-S1 — CE1 ativo Ativo → 201

`POST http://localhost:8080/api/scans` → **HTTP 201 Created** · ✅ Aprovado

**Request body:**

```json
{
  "ativoId": "ativo-001"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 201
- ✓ Varredura enfileirada (EM_FILA)

**Evidência (Response Body — Postman):**

```json
{
  "status": "sucesso",
  "mensagem": "Varredura enfileirada com sucesso",
  "dados": {
    "scanId": "s-14r00c",
    "ativoId": "ativo-001",
    "statusVarredura": "EM_FILA",
    "criadoEm": "2026-06-18T03:45:48Z"
  }
}
```

---

## CT-S2 — CE2 ativo Inativo → 422

`POST http://localhost:8080/api/scans` → **HTTP 422 Unprocessable Entity** · ✅ Aprovado

**Request body:**

```json
{
  "ativoId": "ativo-002"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 422
- ✓ Código de erro ATIVO_INATIVO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Varredura não permitida: ativo está inativo",
  "codigoErro": "ATIVO_INATIVO",
  "timestamp": "2026-06-18T03:45:48Z"
}
```

---

## CT-S3 — CE3 ativo inexistente → 404

`POST http://localhost:8080/api/scans` → **HTTP 404 Not Found** · ✅ Aprovado

**Request body:**

```json
{
  "ativoId": "ativo-999"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 404
- ✓ Código de erro ATIVO_NAO_ENCONTRADO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Ativo não encontrado",
  "codigoErro": "ATIVO_NAO_ENCONTRADO",
  "timestamp": "2026-06-18T03:45:48Z"
}
```

---

## CT-S4 — CE4 sem token → 401

`POST http://localhost:8080/api/scans` → **HTTP 401 Unauthorized** · ✅ Aprovado

**Request body:**

```json
{
  "ativoId": "ativo-001"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 401
- ✓ Código de erro TOKEN_AUSENTE

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Token não fornecido",
  "codigoErro": "TOKEN_AUSENTE",
  "timestamp": "2026-06-18T03:45:48Z"
}
```

---

## CT-S5 — CE5 ativoId ausente → 400

`POST http://localhost:8080/api/scans` → **HTTP 400 Bad Request** · ✅ Aprovado

**Request body:**

```json
{}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 400
- ✓ Código de erro ATIVO_OBRIGATORIO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "ativoId é obrigatório",
  "codigoErro": "ATIVO_OBRIGATORIO",
  "timestamp": "2026-06-18T03:45:48Z"
}
```

---

## CT-A1 — P1 ativo válido → 201

`POST http://localhost:8080/api/assets` → **HTTP 201 Created** · ✅ Aprovado

**Request body:**

```json
{
  "nome": "API Gateway",
  "tipo": "Aplicacao",
  "host": "10.0.0.5"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 201
- ✓ Ativo cadastrado com status Ativo

**Evidência (Response Body — Postman):**

```json
{
  "status": "sucesso",
  "mensagem": "Ativo cadastrado com sucesso",
  "dados": {
    "id": "ativo-35kmba",
    "nome": "API Gateway",
    "tipo": "Aplicacao",
    "host": "10.0.0.5",
    "status": "Ativo"
  }
}
```

---

## CT-A2 — P2 nome vazio → 400

`POST http://localhost:8080/api/assets` → **HTTP 400 Bad Request** · ✅ Aprovado

**Request body:**

```json
{
  "nome": "",
  "tipo": "Servidor",
  "host": "10.0.0.6"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 400
- ✓ Código de erro NOME_OBRIGATORIO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Nome do ativo é obrigatório",
  "codigoErro": "NOME_OBRIGATORIO",
  "timestamp": "2026-06-18T03:45:49Z"
}
```

---

## CT-A3 — P3 tipo inválido → 400

`POST http://localhost:8080/api/assets` → **HTTP 400 Bad Request** · ✅ Aprovado

**Request body:**

```json
{
  "nome": "Roteador",
  "tipo": "Foo",
  "host": "10.0.0.7"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 400
- ✓ Código de erro TIPO_INVALIDO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Tipo de ativo inválido",
  "codigoErro": "TIPO_INVALIDO",
  "timestamp": "2026-06-18T03:45:49Z"
}
```

---

## CT-A4 — P4 host inválido → 400

`POST http://localhost:8080/api/assets` → **HTTP 400 Bad Request** · ✅ Aprovado

**Request body:**

```json
{
  "nome": "Roteador",
  "tipo": "Rede",
  "host": "999.1.1.1"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 400
- ✓ Código de erro HOST_INVALIDO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Host inválido",
  "codigoErro": "HOST_INVALIDO",
  "timestamp": "2026-06-18T03:45:49Z"
}
```

---

## CT-A5 — P5 host duplicado → 409

`POST http://localhost:8080/api/assets` → **HTTP 409 Conflict** · ✅ Aprovado

**Request body:**

```json
{
  "nome": "Duplicado",
  "tipo": "Servidor",
  "host": "192.168.0.10"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 409
- ✓ Código de erro ATIVO_DUPLICADO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Ativo já cadastrado",
  "codigoErro": "ATIVO_DUPLICADO",
  "timestamp": "2026-06-18T03:45:49Z"
}
```

---

## CT-U1 — R1..R4 = S usuário válido → 201

`POST http://localhost:8080/api/users` → **HTTP 201 Created** · ✅ Aprovado

**Request body:**

```json
{
  "nome": "Maria Souza",
  "email": "maria@empresa.com",
  "perfil": "Analista"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 201
- ✓ Perfil retornado

**Evidência (Response Body — Postman):**

```json
{
  "status": "sucesso",
  "mensagem": "Usuário cadastrado com sucesso",
  "dados": {
    "idUsuario": "u-p2mfbn",
    "nome": "Maria Souza",
    "email": "maria@empresa.com",
    "perfil": "Analista"
  }
}
```

---

## CT-U2 — R1 = N nome vazio → 400

`POST http://localhost:8080/api/users` → **HTTP 400 Bad Request** · ✅ Aprovado

**Request body:**

```json
{
  "nome": "",
  "email": "maria@empresa.com",
  "perfil": "Analista"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 400
- ✓ Código de erro NOME_OBRIGATORIO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Nome é obrigatório",
  "codigoErro": "NOME_OBRIGATORIO",
  "timestamp": "2026-06-18T03:45:49Z"
}
```

---

## CT-U3 — R2 = N e-mail inválido → 400

`POST http://localhost:8080/api/users` → **HTTP 400 Bad Request** · ✅ Aprovado

**Request body:**

```json
{
  "nome": "Maria",
  "email": "maria-empresa.com",
  "perfil": "Analista"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 400
- ✓ Código de erro EMAIL_INVALIDO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Email inválido",
  "codigoErro": "EMAIL_INVALIDO",
  "timestamp": "2026-06-18T03:45:49Z"
}
```

---

## CT-U4 — R3 = N perfil inválido → 400

`POST http://localhost:8080/api/users` → **HTTP 400 Bad Request** · ✅ Aprovado

**Request body:**

```json
{
  "nome": "Maria",
  "email": "maria@empresa.com",
  "perfil": "Root"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 400
- ✓ Código de erro PERFIL_INVALIDO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Perfil inválido",
  "codigoErro": "PERFIL_INVALIDO",
  "timestamp": "2026-06-18T03:45:49Z"
}
```

---

## CT-U5 — R4 = N e-mail duplicado → 409

`POST http://localhost:8080/api/users` → **HTTP 409 Conflict** · ✅ Aprovado

**Request body:**

```json
{
  "nome": "Maria",
  "email": "analista@empresa.com",
  "perfil": "Analista"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 409
- ✓ Código de erro EMAIL_DUPLICADO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Email já cadastrado",
  "codigoErro": "EMAIL_DUPLICADO",
  "timestamp": "2026-06-18T03:45:49Z"
}
```

---

## CT-C1 — CE1 destinatário interno → 201

`POST http://localhost:8080/api/campaigns` → **HTTP 201 Created** · ✅ Aprovado

**Request body:**

```json
{
  "nome": "Phishing Q2",
  "destinatario": "colaborador@empresa.com",
  "template": "urgencia"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 201
- ✓ Campanha agendada

**Evidência (Response Body — Postman):**

```json
{
  "status": "sucesso",
  "mensagem": "Campanha criada com sucesso",
  "dados": {
    "idCampanha": "camp-lup86x",
    "nome": "Phishing Q2",
    "destinatario": "colaborador@empresa.com",
    "template": "urgencia",
    "status": "AGENDADA"
  }
}
```

---

## CT-C2 — CE2 destinatário externo → 422

`POST http://localhost:8080/api/campaigns` → **HTTP 422 Unprocessable Entity** · ✅ Aprovado

**Request body:**

```json
{
  "nome": "Phishing Q2",
  "destinatario": "colaborador@gmail.com",
  "template": "urgencia"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 422
- ✓ Código de erro DESTINATARIO_EXTERNO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Destinatário não autorizado: apenas e-mails internos",
  "codigoErro": "DESTINATARIO_EXTERNO",
  "timestamp": "2026-06-18T03:45:50Z"
}
```

---

## CT-C3 — CE3 formato inválido → 400

`POST http://localhost:8080/api/campaigns` → **HTTP 400 Bad Request** · ✅ Aprovado

**Request body:**

```json
{
  "nome": "Phishing Q2",
  "destinatario": "emailinvalido",
  "template": "urgencia"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 400
- ✓ Código de erro EMAIL_INVALIDO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Formato de e-mail inválido",
  "codigoErro": "EMAIL_INVALIDO",
  "timestamp": "2026-06-18T03:45:50Z"
}
```

---

## CT-C4 — CE4 template ausente → 400

`POST http://localhost:8080/api/campaigns` → **HTTP 400 Bad Request** · ✅ Aprovado

**Request body:**

```json
{
  "nome": "Phishing Q2",
  "destinatario": "colaborador@empresa.com",
  "template": ""
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 400
- ✓ Código de erro TEMPLATE_OBRIGATORIO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Template é obrigatório",
  "codigoErro": "TEMPLATE_OBRIGATORIO",
  "timestamp": "2026-06-18T03:45:50Z"
}
```

---

## CT-C5 — CE5 nome vazio → 400

`POST http://localhost:8080/api/campaigns` → **HTTP 400 Bad Request** · ✅ Aprovado

**Request body:**

```json
{
  "nome": "",
  "destinatario": "colaborador@empresa.com",
  "template": "urgencia"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 400
- ✓ Código de erro NOME_OBRIGATORIO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Nome da campanha é obrigatório",
  "codigoErro": "NOME_OBRIGATORIO",
  "timestamp": "2026-06-18T03:45:50Z"
}
```

---

## CT-F: cvss=3.9 → Baixo

`GET http://localhost:8080/api/findings/classificacao` → **HTTP 200 OK** · ✅ Aprovado

**Asserções (Postman Tests):**

- ✓ Status code deve ser 200
- ✓ Faixa Baixo

**Evidência (Response Body — Postman):**

```json
{
  "status": "sucesso",
  "dados": {
    "cvss": 3.9,
    "faixa": "Baixo"
  }
}
```

---

## CT-F: cvss=4.0 → Médio

`GET http://localhost:8080/api/findings/classificacao` → **HTTP 200 OK** · ✅ Aprovado

**Asserções (Postman Tests):**

- ✓ Status code deve ser 200
- ✓ Faixa Médio

**Evidência (Response Body — Postman):**

```json
{
  "status": "sucesso",
  "dados": {
    "cvss": 4,
    "faixa": "Médio"
  }
}
```

---

## CT-F: cvss=6.9 → Médio

`GET http://localhost:8080/api/findings/classificacao` → **HTTP 200 OK** · ✅ Aprovado

**Asserções (Postman Tests):**

- ✓ Status code deve ser 200
- ✓ Faixa Médio

**Evidência (Response Body — Postman):**

```json
{
  "status": "sucesso",
  "dados": {
    "cvss": 6.9,
    "faixa": "Médio"
  }
}
```

---

## CT-F: cvss=7.0 → Alto

`GET http://localhost:8080/api/findings/classificacao` → **HTTP 200 OK** · ✅ Aprovado

**Asserções (Postman Tests):**

- ✓ Status code deve ser 200
- ✓ Faixa Alto

**Evidência (Response Body — Postman):**

```json
{
  "status": "sucesso",
  "dados": {
    "cvss": 7,
    "faixa": "Alto"
  }
}
```

---

## CT-F: cvss=8.9 → Alto

`GET http://localhost:8080/api/findings/classificacao` → **HTTP 200 OK** · ✅ Aprovado

**Asserções (Postman Tests):**

- ✓ Status code deve ser 200
- ✓ Faixa Alto

**Evidência (Response Body — Postman):**

```json
{
  "status": "sucesso",
  "dados": {
    "cvss": 8.9,
    "faixa": "Alto"
  }
}
```

---

## CT-F: cvss=9.0 → Crítico

`GET http://localhost:8080/api/findings/classificacao` → **HTTP 200 OK** · ✅ Aprovado

**Asserções (Postman Tests):**

- ✓ Status code deve ser 200
- ✓ Faixa Crítico

**Evidência (Response Body — Postman):**

```json
{
  "status": "sucesso",
  "dados": {
    "cvss": 9,
    "faixa": "Crítico"
  }
}
```

---

## CT-F: cvss=10.0 → Crítico

`GET http://localhost:8080/api/findings/classificacao` → **HTTP 200 OK** · ✅ Aprovado

**Asserções (Postman Tests):**

- ✓ Status code deve ser 200
- ✓ Faixa Crítico

**Evidência (Response Body — Postman):**

```json
{
  "status": "sucesso",
  "dados": {
    "cvss": 10,
    "faixa": "Crítico"
  }
}
```

---

## CT-F: cvss=10.1 (acima do máximo) → 400

`GET http://localhost:8080/api/findings/classificacao` → **HTTP 400 Bad Request** · ✅ Aprovado

**Asserções (Postman Tests):**

- ✓ Status code deve ser 400
- ✓ Código de erro CVSS_INVALIDO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "CVSS deve estar entre 0.0 e 10.0",
  "codigoErro": "CVSS_INVALIDO",
  "timestamp": "2026-06-18T03:45:51Z"
}
```

---

## CT-F: cvss=-0.1 (abaixo do mínimo) → 400

`GET http://localhost:8080/api/findings/classificacao` → **HTTP 400 Bad Request** · ✅ Aprovado

**Asserções (Postman Tests):**

- ✓ Status code deve ser 400
- ✓ Código de erro CVSS_INVALIDO

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "CVSS deve estar entre 0.0 e 10.0",
  "codigoErro": "CVSS_INVALIDO",
  "timestamp": "2026-06-18T03:45:51Z"
}
```

---

