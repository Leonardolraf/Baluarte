// Relatorio de testes do backend (item 3.2 do roteiro: % de cobertura e taxa de sucesso).
// Le o resultado JUnit e o resumo de cobertura do c8 de cada suite e escreve
// coverage/RELATORIO.md. Rodar depois de `npm run cobertura:unidade` e `npm run cobertura`
// (ou tudo junto: `npm run test:relatorio`).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SUITES = [
  { nome: 'Unidade (sem banco nem servidor)', pasta: 'coverage-unidade' },
  { nome: 'Completa (unidade + integração + pentest)', pasta: 'coverage' },
];

function contarJunit(arquivo) {
  const xml = readFileSync(arquivo, 'utf8');
  // Conta as tags (o nome do teste pode ter ">" dentro do atributo, o que quebra regex de elemento).
  const contar = (tag) => (xml.match(new RegExp(`<${tag}[\\s/>]`, 'g')) ?? []).length;
  const total = contar('testcase');
  const falhas = contar('failure');
  const pulados = contar('skipped');
  return { total, falhas, pulados, aprovados: total - falhas - pulados };
}

const pct = (n) => `${n.toFixed(2).replace('.', ',')}%`;
const linhas = [
  '# Relatório de testes do backend',
  '',
  `Gerado em ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC por \`npm run test:relatorio\`.`,
  '',
  '| Suíte | Testes | Aprovados | Falhas | Taxa de sucesso | Linhas | Ramos | Funções |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
];
let algumaFalha = false;

for (const s of SUITES) {
  const junit = `${s.pasta}/junit.xml`;
  const resumo = `${s.pasta}/coverage-summary.json`;
  if (!existsSync(junit) || !existsSync(resumo)) {
    linhas.push(`| ${s.nome} | — | — | — | não executada | — | — | — |`);
    continue;
  }
  const t = contarJunit(junit);
  const c = JSON.parse(readFileSync(resumo, 'utf8')).total;
  const executados = t.total - t.pulados;
  const taxa = executados ? (t.aprovados / executados) * 100 : 0;
  if (t.falhas) algumaFalha = true;
  linhas.push(
    `| ${s.nome} | ${t.total} | ${t.aprovados} | ${t.falhas} | ${pct(taxa)} | ${pct(c.lines.pct)} | ${pct(c.branches.pct)} | ${pct(c.functions.pct)} |`,
  );
}

linhas.push(
  '',
  'Cobertura medida pelo c8 (V8) sobre `src/`. Na suíte de unidade entram só os módulos de domínio',
  '(rotas, `app.ts` e `server.ts` são exercitados pela integração). Relatório navegável por arquivo:',
  '`coverage/index.html` e `coverage-unidade/index.html`.',
  '',
);

mkdirSync('coverage', { recursive: true });
writeFileSync('coverage/RELATORIO.md', linhas.join('\n'), 'utf8');
console.log(linhas.join('\n'));
if (algumaFalha) process.exitCode = 1;
