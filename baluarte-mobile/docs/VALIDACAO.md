# Validação — Baluarte (app mobile)

**Data:** 23/09/2026 · **Ambiente:** Windows 11 Pro, Node 24.16.0, npm 11.13.0, expo-doctor 1.20.4

O app foi construído, validado por um revisor independente (que reprovou a primeira versão com 1 achado médio e 12 baixos), corrigido (14 itens) e passou pela checagem final abaixo.

## Checagem final

| Comando | Resultado |
|---|---|
| `npm run typecheck` (`tsc --noEmit`, `strict`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`) | ok — 134 arquivos, sem erros |
| `npm test -- --ci` | ok — 14 suítes, 82 testes, 0 pulados |
| `npx expo export --platform web` | ok — 674 módulos, bundle de 963 KB em `dist/` |
| `npx expo-doctor` | ok — 21/21 checagens |

| Arquivo de teste | Testes |
|---|---|
| `src/__tests__/components/GroupPickerModal.test.tsx` | 3 |
| `src/__tests__/components/TemplateSelect.test.tsx` | 6 |
| `src/__tests__/components/Toast.test.tsx` | 3 |
| `src/__tests__/lib/auth.test.ts` | 4 |
| `src/__tests__/lib/campaigns.test.ts` | 6 |
| `src/__tests__/lib/format.test.ts` | 10 |
| `src/__tests__/lib/validation.test.ts` | 11 |
| `src/__tests__/routes/linking.test.ts` | 3 |
| `src/__tests__/screens/CampaignDetails.test.tsx` | 5 |
| `src/__tests__/screens/Home.test.tsx` | 7 |
| `src/__tests__/screens/Login.test.tsx` | 8 |
| `src/__tests__/screens/NewCampaign.test.tsx` | 8 |
| `src/__tests__/screens/ResetPassword.test.tsx` | 2 |
| `src/__tests__/screens/Training.test.tsx` | 6 |
| **Total** | **82** |

Versões: Expo SDK 57 (`expo 57.0.24`), React Native 0.86.3, React 19.2.3, React Navigation 7, TypeScript 6.0.3, Jest 29.7 + jest-expo 57 + Testing Library 14.

## Verificações extras

- **Bundle nativo (o que o Expo Go carrega):** `npx expo export --platform android --platform ios` compila (Hermes, cerca de 2,2 MB por plataforma).
- **Testes sem depender da data:** o "hoje" dos testes é fixo (23/09/2026); as suítes passaram 82/82 também com o relógio deslocado para 01/11/2026 e 15/01/2027.
- **Fluxo no navegador (375×812, Chrome headless):** login com `admin@empresa.com` → Home (Total 5) → Detalhes da "Simulação Q3 – Financeiro" → Ver material de treinamento → voltar → Nova campanha → modelo Autoridade → lista de grupos → RH → nome da campanha → Agendar campanha → aviso "Campanha agendada com sucesso" → Detalhes da campanha nova ("Grupo-alvo: RH · Modelo: Autoridade", destinatários "Não recebeu") → Home com a campanha nova e "Total 6". A validação do formulário também foi exercitada (sem nome: "Informe o nome da campanha."). Nenhum erro de página ou de console. As telas foram comparadas com as capturas do Figma em `docs/referencias/`.

## Independência (repositório sozinho)

O commit `0af8181` foi clonado numa pasta isolada, fora da pasta onde os dois apps foram desenvolvidos, e testado do zero:

| Passo | Resultado |
|---|---|
| `git clone` | 162 arquivos versionados, sem `node_modules` |
| `npm ci` | 794 pacotes instalados |
| `npm run typecheck` | ok |
| `npx jest --ci` | 14 suítes, 82 testes |
| `npx expo export --platform web` | ok |
| `npx expo-doctor` | 21/21 |
| fluxo completo no navegador, usando o `dist/` gerado no clone | ok, sem erros de página ou de console |

Nenhum import ou asset aponta para fora da pasta do app (318 imports relativos conferidos), e os dados vêm de cópias locais em `src/data/` — o app não lê nada do repositório do produto web em tempo de execução. O Baluarte Mobile não depende do [GamePlay-App](https://github.com/Leonardolraf/GamePlay-App), e os dois podem rodar ao mesmo tempo: os scripts fixam o Metro na porta 8083 (Baluarte) e 8082 (GamePlay), fora da 8081 usada pelo Docker do Baluarte.

## Limites

- O app não foi aberto num aparelho com o Expo Go (não havia aparelho no ambiente). O lado nativo está coberto pelos testes (jest-expo) e pela compilação do bundle Hermes; a primeira abertura no celular é a prova final.
- A autenticação é simulada (contas de demonstração, sem senha fixa no código) e os dados ficam em memória.
- O navegador testado foi o Chromium (Chrome/Edge); Safari e Firefox não foram testados.

## Para repetir

```bash
npm install
npm run typecheck
npm test -- --ci
npx expo export --platform web
npx expo-doctor
```
