#!/usr/bin/env node
// Suíte funcional (Playwright, modo mock) nos outros navegadores do RNF-007 (B30):
// Firefox e WebKit do Playwright e o Microsoft Edge da máquina (channel "msedge"), em 1366×768.
// A suíte padrão (`npm run test:e2e`) continua só no Chrome; este script liga E2E_NAVEGADORES=1.
//
//   npm run test:e2e:navegadores:instalar   # baixa o Firefox e o WebKit do Playwright (uma vez)
//   npm run test:e2e:navegadores            # roda (argumentos extras vão para o playwright test,
//                                           # ex.: -- --project=firefox-desktop)
//
// - O WebKit do Playwright é o motor do Safari compilado para Windows/Linux, NÃO o Safari da Apple.
// - Os navegadores do Playwright ficam dentro de node_modules (PLAYWRIGHT_BROWSERS_PATH=0), não
//   em %LOCALAPPDATA%\ms-playwright: no Windows da equipe o Firefox do Playwright não abre a
//   partir de lá (erro "configuração lado a lado incorreta" ao carregar o mozglue), e abre de
//   qualquer pasta do perfil do usuário. Quem já define PLAYWRIGHT_BROWSERS_PATH mantém o seu.
// - Sem E2E_BASE_URL, o Playwright sobe um Vite próprio na camada mock na porta E2E_PORT
//   (padrão 5202, longe da 5173 do desenvolvimento) e o derruba no fim.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(FRONTEND, 'node_modules', '@playwright', 'test', 'cli.js');

const [primeiro, ...resto] = process.argv.slice(2);
const instalar = primeiro === 'instalar';
const args = instalar ? ['install', 'firefox', 'webkit', ...resto] : ['test', ...process.argv.slice(2)];

const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? '0' };
if (!instalar) {
  env.E2E_NAVEGADORES = '1';
  if (!env.E2E_BASE_URL) {
    env.E2E_PORT = env.E2E_PORT ?? '5202';
    // O Vite que o Playwright sobe fica na camada mock, mesmo que o .env aponte para a API real.
    env.VITE_USE_MOCKS = 'true';
  }
}

const filho = spawn(process.execPath, [CLI, ...args], { cwd: FRONTEND, env, stdio: 'inherit' });
filho.once('exit', (codigo, sinal) => process.exit(codigo ?? (sinal ? 1 : 0)));
