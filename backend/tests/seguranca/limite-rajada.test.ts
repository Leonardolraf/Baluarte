// Pentest automatizado — DIMENSAO limites sob rajada paralela (DT09).
// O teste sequencial do limite de login (conta-forca-bruta.test.ts) passa mesmo com o defeito:
// o service contava as falhas ANTES do bcrypt e gravava DEPOIS, entao N tentativas simultaneas
// liam "0 falhas", todas avaliavam a senha e nenhuma recebia 429. Aqui as requisicoes saem
// juntas (Promise.all) e o que se confere e o teto: no maximo LOGIN_MAX_FALHAS senhas avaliadas,
// o resto 429 com o codigo e a mensagem do contrato; o mesmo para o limite de pedidos de
// redefinicao de senha (3 por e-mail na janela).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  prepararBanco,
  iniciarServidor,
  encerrarServidor,
  chamar,
  login,
  criarUsuario,
  emailUnico,
  ADMIN,
  SENHA_CONTA,
  type Resposta,
} from '../helpers.js';

prepararBanco(import.meta.url);
const { app } = await import('../../src/app.js');
const { prisma } = await import('../../src/config/db.js');

const RAJADA = 20;
// Teto de pedidos de redefinicao por e-mail na janela (o mesmo do teste sequencial).
const RESET_MAX = 3;
const MSG_LOGIN_BLOQUEADO = 'Muitas tentativas de login. Aguarde alguns minutos.';
const MSG_RESET_BLOQUEADO = 'Muitas solicitações. Aguarde alguns minutos.';

let admin = '';
// O teto vem da politica publicada (a mesma constante do service), nao de um numero repetido aqui.
let maxFalhas = 0;
before(async () => {
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  const politica = await chamar('GET', '/configuracoes/seguranca', { token: admin });
  maxFalhas = politica.body.dados.sessao.limiteTentativasLogin;
  assert.ok(Number.isInteger(maxFalhas) && maxFalhas > 0 && maxFalhas < RAJADA, `limite inesperado: ${maxFalhas}`);
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

/** Varia a caixa do e-mail: a chave do limite e o e-mail normalizado, entao todas contam juntas. */
const variante = (email: string, i: number) => (i % 2 ? email.toUpperCase() : email);

const tentar = (email: string, senha: string) => chamar('POST', '/login', { body: { email, senha } });

/** Rajada de senhas erradas, todas disparadas ao mesmo tempo. */
const rajadaErrada = (email: string, n = RAJADA) =>
  Promise.all(Array.from({ length: n }, (_, i) => tentar(variante(email, i), `Errada@${i}x`)));

function contar(respostas: Resposta[]) {
  const por = (s: number) => respostas.filter((r) => r.status === s);
  return { s200: por(200), s401: por(401), s429: por(429) };
}

/** Toda resposta e do contrato: 401 CREDENCIAIS_INVALIDAS ou 429 MUITAS_TENTATIVAS com a mensagem de hoje. */
function conferirContratoLogin(respostas: Resposta[]) {
  for (const r of respostas) {
    if (r.status === 401) {
      assert.equal(r.body.codigoErro, 'CREDENCIAIS_INVALIDAS');
      assert.equal(r.body.mensagem, 'E-mail ou senha inválidos');
    } else {
      assert.equal(r.status, 429, `status inesperado na rajada: ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.body.status, 'erro');
      assert.equal(r.body.codigoErro, 'MUITAS_TENTATIVAS');
      assert.equal(r.body.mensagem, MSG_LOGIN_BLOQUEADO);
    }
  }
}

const falhasGravadas = (email: string) => prisma.loginFailure.count({ where: { email: email.toLowerCase() } });

// =============================================================================
describe('DT09: limite de login sob rajada paralela', () => {
  it(`${RAJADA} senhas erradas simultaneas: no maximo o limite chega ao bcrypt (401), o resto e 429`, async (t) => {
    const alvo = await criarUsuario(admin, 'Colaborador', 'rajada.login');
    const respostas = await rajadaErrada(alvo.email);
    conferirContratoLogin(respostas);
    const { s401, s429 } = contar(respostas);
    assert.ok(s401.length <= maxFalhas, `${s401.length} tentativas avaliaram a senha (limite ${maxFalhas})`);
    assert.equal(s401.length + s429.length, RAJADA);
    assert.ok(s429.length >= RAJADA - maxFalhas);
    // Falhas gravadas: so as tentativas que de fato avaliaram a senha (nenhuma reserva sobra
    // das recusadas) e nunca acima do limite.
    const gravadas = await falhasGravadas(alvo.email);
    assert.ok(gravadas <= maxFalhas, `${gravadas} falhas gravadas (limite ${maxFalhas})`);
    assert.equal(gravadas, s401.length);
    t.diagnostic(`login: ${s401.length} x 401, ${s429.length} x 429, ${gravadas} falhas gravadas`);
    // O bloqueio e auditado uma vez, como no caminho sequencial.
    const bloqueios = await prisma.auditLog.count({ where: { usuarioId: alvo.id, acao: 'LOGIN_BLOQUEADO' } });
    assert.equal(bloqueios, s401.length === maxFalhas ? 1 : 0);
    // Depois da rajada a conta segue bloqueada, inclusive para a senha certa (bloqueio no banco).
    const certa = await tentar(alvo.email, SENHA_CONTA);
    assert.equal(certa.status, 429);
    assert.equal(certa.body.codigoErro, 'MUITAS_TENTATIVAS');
  });

  it('a rajada contra e-mail inexistente tambem para no limite (sem canal privilegiado para adivinhar contas)', async () => {
    const fantasma = emailUnico('rajada.fantasma');
    const respostas = await rajadaErrada(fantasma);
    conferirContratoLogin(respostas);
    const { s401 } = contar(respostas);
    assert.ok(s401.length <= maxFalhas, `${s401.length} tentativas avaliaram a senha (limite ${maxFalhas})`);
    assert.ok((await falhasGravadas(fantasma)) <= maxFalhas);
  });

  it('senha certa no meio da rajada, depois de o limite estourar: 429 (como no caminho sequencial)', async () => {
    const alvo = await criarUsuario(admin, 'Colaborador', 'rajada.certa');
    const emAndamento = rajadaErrada(alvo.email);
    // Espera o limite estourar com a rajada ainda em andamento (no maximo 5 s) e entao
    // dispara a senha certa no meio dela.
    for (let i = 0; i < 500 && (await falhasGravadas(alvo.email)) < maxFalhas; i++) await sleep(10);
    const certa = await tentar(variante(alvo.email, 1), SENHA_CONTA);
    const respostas = await emAndamento;
    assert.equal(certa.status, 429, `a senha certa passou depois do limite: ${certa.status} ${JSON.stringify(certa.body)}`);
    assert.equal(certa.body.codigoErro, 'MUITAS_TENTATIVAS');
    assert.equal(certa.body.mensagem, MSG_LOGIN_BLOQUEADO);
    conferirContratoLogin(respostas);
    assert.ok(contar(respostas).s401.length <= maxFalhas);
    assert.ok((await falhasGravadas(alvo.email)) <= maxFalhas);
  });

  it('senha certa disparada junto com a rajada: nunca mais do que o limite de senhas erradas avaliadas por vez', async (t) => {
    const alvo = await criarUsuario(admin, 'Colaborador', 'rajada.mista');
    const meio = Math.floor(RAJADA / 2);
    const respostas = await Promise.all(
      Array.from({ length: RAJADA + 1 }, (_, i) =>
        tentar(variante(alvo.email, i), i === meio ? SENHA_CONTA : `Errada@${i}x`)),
    );
    const certa = respostas[meio];
    const erradas = respostas.filter((_, i) => i !== meio);
    conferirContratoLogin(erradas);
    const { s401 } = contar(erradas);
    if (certa.status === 200) {
      // A senha certa ganhou uma vaga antes do limite: o login valido zera o contador (regra de
      // hoje), entao cabe no maximo (limite - 1) falhas antes dela e o limite inteiro depois.
      assert.ok(s401.length <= 2 * maxFalhas - 1, `${s401.length} senhas erradas avaliadas`);
    } else {
      // Chegou depois do limite: bloqueada como qualquer outra, e o teto vale para a rajada toda.
      assert.equal(certa.status, 429, `status inesperado da senha certa: ${certa.status}`);
      assert.equal(certa.body.codigoErro, 'MUITAS_TENTATIVAS');
      assert.ok(s401.length <= maxFalhas, `${s401.length} senhas erradas avaliadas (limite ${maxFalhas})`);
    }
    assert.ok((await falhasGravadas(alvo.email)) <= maxFalhas);
    t.diagnostic(`mista: senha certa ${certa.status}, ${s401.length} x 401 nas erradas`);
  });
});

// =============================================================================
describe('DT09: limite de pedidos de redefinicao sob rajada paralela', () => {
  it(`${RAJADA} pedidos simultaneos para o mesmo e-mail: no maximo ${RESET_MAX} passam (e geram link), o resto e 429`, async (t) => {
    const alvo = await criarUsuario(admin, 'Colaborador', 'rajada.reset');
    const respostas = await Promise.all(
      Array.from({ length: RAJADA }, (_, i) => chamar('POST', '/auth/reset-password', { body: { email: variante(alvo.email, i) } })),
    );
    const { s200, s429 } = contar(respostas);
    assert.ok(s200.length <= RESET_MAX, `${s200.length} pedidos aceitos (limite ${RESET_MAX})`);
    assert.equal(s200.length + s429.length, RAJADA, `status inesperado: ${respostas.map((r) => r.status).join(',')}`);
    for (const r of s429) {
      assert.equal(r.body.codigoErro, 'MUITAS_TENTATIVAS');
      assert.equal(r.body.mensagem, MSG_RESET_BLOQUEADO);
    }
    assert.ok((await prisma.resetRequest.count({ where: { email: alvo.email.toLowerCase() } })) <= RESET_MAX);
    // Cada pedido aceito emite um link; os recusados nao emitem nada (nem e-mail).
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: alvo.id, tipo: 'RESET' } }), s200.length);
    t.diagnostic(`reset: ${s200.length} x 200, ${s429.length} x 429`);
  });
});
