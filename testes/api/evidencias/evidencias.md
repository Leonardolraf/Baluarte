# Evidências de execução — Testes de API (Newman/Postman)

Execução real da collection contra o stub local (`http://localhost:8080`) em **17/06/2026, 23:41:52**.
**11 requisições · 22 asserções · 0 falhas.**

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
- ✓ Retorna token e perfil do usuário

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

## CT-L2 — CE2 e-mail com formato inválido → 400

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
- ✓ Mensagem de formato de e-mail inválido

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Formato de e-mail inválido",
  "codigoErro": "EMAIL_INVALIDO",
  "timestamp": "2026-06-18T02:41:52Z"
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
- ✓ Credenciais inválidas

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "E-mail ou senha inválidos",
  "codigoErro": "CREDENCIAIS_INVALIDAS",
  "timestamp": "2026-06-18T02:41:52Z"
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
- ✓ E-mail é obrigatório

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "E-mail é obrigatório",
  "codigoErro": "EMAIL_OBRIGATORIO",
  "timestamp": "2026-06-18T02:41:53Z"
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
- ✓ Credenciais inválidas

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "E-mail ou senha inválidos",
  "codigoErro": "CREDENCIAIS_INVALIDAS",
  "timestamp": "2026-06-18T02:41:53Z"
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
- ✓ Senha é obrigatória

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Senha é obrigatória",
  "codigoErro": "SENHA_OBRIGATORIA",
  "timestamp": "2026-06-18T02:41:53Z"
}
```

---

## CT-S1 — CE1 ativo com status Ativo → 201

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
    "scanId": "s-xnv1zv",
    "ativoId": "ativo-001",
    "statusVarredura": "EM_FILA",
    "criadoEm": "2026-06-18T02:41:53Z"
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
- ✓ Ativo inativo bloqueia a varredura

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Varredura não permitida: ativo está inativo",
  "codigoErro": "ATIVO_INATIVO",
  "timestamp": "2026-06-18T02:41:53Z"
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
- ✓ Ativo não encontrado

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Ativo não encontrado",
  "codigoErro": "ATIVO_NAO_ENCONTRADO",
  "timestamp": "2026-06-18T02:41:53Z"
}
```

---

## CT-S4 — CE4 requisição sem token → 401

`POST http://localhost:8080/api/scans` → **HTTP 401 Unauthorized** · ✅ Aprovado

**Request body:**

```json
{
  "ativoId": "ativo-001"
}
```

**Asserções (Postman Tests):**

- ✓ Status code deve ser 401
- ✓ Token não fornecido

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "Token não fornecido",
  "codigoErro": "TOKEN_AUSENTE",
  "timestamp": "2026-06-18T02:41:53Z"
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
- ✓ ativoId é obrigatório

**Evidência (Response Body — Postman):**

```json
{
  "status": "erro",
  "mensagem": "ativoId é obrigatório",
  "codigoErro": "ATIVO_OBRIGATORIO",
  "timestamp": "2026-06-18T02:41:53Z"
}
```

---

