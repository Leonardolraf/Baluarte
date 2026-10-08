// B24 — relatorio de vulnerabilidades em PDF, sem banco: montagem do modelo (resumo,
// ordem por CVSS, datas no fuso de Brasilia, nome do arquivo), conversao para WinAnsi e o
// PDF desenhado (assinatura, acentos, quebra de pagina, "Página X de Y").
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dadosAchado, type ChaveAchado } from '../../src/models/catalogoAchado.model.js';
import type { FindingComScan } from '../../src/models/vulnerabilidade.model.js';
import {
  dataHora,
  descreverFiltros,
  montarRelatorio,
  nomeDoArquivo,
} from '../../src/services/relatorioVulnerabilidade.service.js';
import { desenharRelatorioPdf, paraWinAnsi } from '../../src/services/relatorioPdf.service.js';
import { paginasDoPdf, textoDoPdf } from '../pdf.js';

const AUTOR = { nome: 'Analista de Segurança', email: 'analista@empresa.com', perfil: 'Analista' };

let seq = 0;
function achado(chave: ChaveAchado, status = 'Aberta', host = '10.0.0.1', criadoEm = new Date('2026-10-01T12:00:00Z')): FindingComScan {
  seq += 1;
  return {
    id: `f${seq}`,
    ...dadosAchado(chave),
    status,
    criadoEm,
    scan: { asset: { host, nome: 'Servidor de Produção' } },
  };
}

describe('montagem do relatório (dados antes do desenho)', () => {
  it('resume por severidade e status (com zeros, na ordem oficial) e calcula CVSS médio e máximo', () => {
    const r = montarRelatorio(
      [achado('cors-curinga', 'Resolvida'), achado('injecao-sql'), achado('controle-acesso', 'Em revisão', '10.0.0.2')],
      { status: undefined },
      AUTOR,
    );
    assert.equal(r.resumo.total, 3);
    assert.equal(r.resumo.ativos, 2);
    assert.deepEqual(r.resumo.porSeveridade, [
      { rotulo: 'Crítico', total: 1 },
      { rotulo: 'Alto', total: 1 },
      { rotulo: 'Médio', total: 1 },
      { rotulo: 'Baixo', total: 0 },
    ]);
    assert.deepEqual(
      r.resumo.porStatus.map((c) => `${c.rotulo}=${c.total}`),
      ['Aberta=1', 'Em revisão=1', 'Em remediação=0', 'Resolvida=1', 'Risco aceito=0'],
    );
    assert.equal(r.resumo.cvssMaximo, 9.8);
    assert.equal(r.resumo.cvssMedio, 7.4); // (4.3 + 9.8 + 8.1) / 3 = 7.4
    assert.deepEqual(r.autor, AUTOR);
  });

  it('ordena por CVSS desc e, no empate, o achado mais recente primeiro', () => {
    const antigo = achado('idor', 'Aberta', '10.0.0.1', new Date('2026-10-01T00:00:00Z'));
    const recente = achado('sessao-sem-expiracao', 'Aberta', '10.0.0.2', new Date('2026-10-05T00:00:00Z'));
    const r = montarRelatorio([achado('cors-curinga'), antigo, achado('injecao-sql'), recente], {}, AUTOR);
    assert.deepEqual(r.achados.map((a) => a.cvss), [9.8, 6.5, 6.5, 4.3]);
    assert.equal(r.achados[1].ativo, '10.0.0.2', 'empate de nota: o mais recente vem antes');
  });

  it('sem achados: total zero e CVSS nulo', () => {
    const r = montarRelatorio([], {}, AUTOR);
    assert.equal(r.resumo.total, 0);
    assert.equal(r.resumo.cvssMedio, null);
    assert.equal(r.resumo.cvssMaximo, null);
  });

  it('datas e nome do arquivo no horário de Brasília (o servidor roda em UTC)', () => {
    const madrugadaUtc = new Date('2026-10-08T02:30:00Z'); // 23:30 de 07/10 em Brasília
    assert.equal(nomeDoArquivo(madrugadaUtc), 'baluarte-vulnerabilidades-2026-10-07.pdf');
    assert.equal(dataHora(madrugadaUtc), '07/10/2026 23:30');
    assert.equal(nomeDoArquivo(new Date('2026-10-08T15:00:00Z')), 'baluarte-vulnerabilidades-2026-10-08.pdf');
  });

  it('descreve os filtros para o cabeçalho e a auditoria', () => {
    assert.equal(descreverFiltros({}), 'severidade: todas; status: todos; busca: nenhuma');
    assert.equal(descreverFiltros({ severidade: 'Alto', status: 'Aberta', q: '10.0' }), 'severidade: Alto; status: Aberta; busca: "10.0"');
  });
});

describe('texto nas fontes padrão do PDF (WinAnsi)', () => {
  it('mantém o português e troca o que a fonte não tem', () => {
    assert.equal(paraWinAnsi('Relatório de remediação — Crítico · “aspas” …'), 'Relatório de remediação — Crítico · “aspas” …');
    assert.equal(paraWinAnsi('Ōsaka'), 'Osaka', 'acento fora do Latin-1 perde o acento');
    assert.equal(paraWinAnsi('servidor 😀 东京'), 'servidor ? ??', 'sem equivalente vira ?');
    assert.equal(paraWinAnsi('a\tb\u0007c\nd'), 'a b c\nd', 'controle vira espaço; quebra de linha fica');
    assert.equal(paraWinAnsi('ação'), 'ação', 'forma decomposta é recomposta (NFC)');
  });
});

describe('PDF desenhado', () => {
  it('é um PDF com cabeçalho, resumo, achados e acentos legíveis', async () => {
    const r = montarRelatorio([achado('componente-vulneravel'), achado('injecao-sql', 'Em remediação')], { severidade: 'Crítico' }, AUTOR, new Date('2026-10-08T17:32:00Z'));
    const pdf = await desenharRelatorioPdf(r);
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.match(pdf.subarray(-6).toString('latin1'), /%%EOF/);
    assert.match(pdf.toString('latin1'), /\(Achados: 2\)/, 'quantidade nos metadados (Subject)');
    const texto = textoDoPdf(pdf);
    for (const trecho of [
      'Baluarte',
      'Relatório de vulnerabilidades',
      'Gerado em 08/10/2026 14:32 (horário de Brasília) por Analista de Segurança (analista@empresa.com) — Analista',
      'severidade: Crítico; status: todos; busca: nenhuma',
      'CVSS médio',
      'Em remediação',
      'CVE-2019-10744',
      'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      'Servidor de Produção',
      'Página 1 de 1',
    ])
      assert.ok(texto.includes(trecho), `faltou no PDF: ${trecho}`);
    assert.ok(texto.indexOf('9.8') < texto.indexOf('9.1'), 'achados por CVSS desc');
    assert.ok(!texto.includes('evidência') && !texto.includes(dadosAchado('injecao-sql').evidencia.slice(0, 20)), 'sem evidência');
  });

  it('quebra a página sem cortar linha, repete o cabeçalho da tabela e numera "Página X de Y"', async () => {
    const chaves: ChaveAchado[] = ['injecao-sql', 'controle-acesso', 'idor', 'cors-curinga', 'componente-vulneravel'];
    const r = montarRelatorio(Array.from({ length: 60 }, (_, i) => achado(chaves[i % chaves.length], 'Aberta', `10.1.0.${i}`)), {}, AUTOR);
    const pdf = await desenharRelatorioPdf(r);
    const paginas = paginasDoPdf(pdf);
    assert.ok(paginas >= 3, `60 achados ocupam mais de duas páginas (vieram ${paginas})`);
    const texto = textoDoPdf(pdf);
    for (let p = 1; p <= paginas; p++) assert.ok(texto.includes(`Página ${p} de ${paginas}`), `rodapé da página ${p}`);
    assert.equal(texto.split('\n').filter((l) => l === 'Categoria OWASP').length, paginas, 'cabeçalho da tabela em cada página');
    for (let i = 0; i < 60; i++) assert.ok(texto.includes(`10.1.0.${i}\n`) || texto.endsWith(`10.1.0.${i}`), `achado ${i} presente`);
  });

  it('relatório vazio ainda abre, com a mensagem de nenhum achado', async () => {
    const pdf = await desenharRelatorioPdf(montarRelatorio([], {}, AUTOR));
    assert.equal(paginasDoPdf(pdf), 1);
    assert.ok(textoDoPdf(pdf).includes('Nenhum achado para os filtros aplicados.'));
  });
});
