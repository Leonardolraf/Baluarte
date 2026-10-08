// Tabela dos programas Windows mais comuns -> CPE do NVD (B14).
//
// No Windows o osquery le o nome do programa como o instalador o registrou ("Mozilla Firefox
// (x64 pt-BR)", "7-Zip 23.01 (x64)"), que nao bate com o catalogo oficial de produtos (CPE)
// do NVD. Por isso o cruzamento so consulta os programas desta tabela: cada linha casa o nome
// por expressao regular e diz o fornecedor e o produto do CPE, alem de como ler a versao.
// Programa fora da tabela nao e consultado (nao ha como saber o CPE sem adivinhar).
// O CPE consultado e cpe:2.3:a:<fornecedor>:<produto>:<versao>:*:*:*:*:*:*:* (API 2.0, cpeName).

export interface ProgramaCpe {
  /** Nome canonico do programa: e o que vai no achado (Finding.programa). */
  programa: string;
  /** Casa o nome que o osquery le (tabela programs, coluna name). */
  padrao: RegExp;
  /** Fornecedor e produto no CPE 2.3 (ja escapados como o CPE exige). */
  fornecedor: string;
  produto: string;
  /** Quantos componentes numericos da versao o NVD usa (ex.: PuTTY "0.81.0.0" -> "0.81"). */
  componentes?: number;
}

// A ordem importa: a primeira linha que casa vence (Firefox ESR antes do Firefox).
export const TABELA_CPE_WINDOWS: readonly ProgramaCpe[] = [
  { programa: 'Google Chrome', padrao: /^Google Chrome$/i, fornecedor: 'google', produto: 'chrome' },
  { programa: 'Microsoft Edge', padrao: /^Microsoft Edge$/i, fornecedor: 'microsoft', produto: 'edge_chromium' },
  { programa: 'Mozilla Firefox ESR', padrao: /^Mozilla Firefox ESR\b/i, fornecedor: 'mozilla', produto: 'firefox_esr' },
  { programa: 'Mozilla Firefox', padrao: /^Mozilla Firefox\b/i, fornecedor: 'mozilla', produto: 'firefox' },
  { programa: 'Mozilla Thunderbird', padrao: /^Mozilla Thunderbird\b/i, fornecedor: 'mozilla', produto: 'thunderbird' },
  { programa: 'Adobe Acrobat Reader', padrao: /^Adobe Acrobat( Reader)?( DC)?( \(64-bit\))?$/i, fornecedor: 'adobe', produto: 'acrobat_reader_dc' },
  { programa: '7-Zip', padrao: /^7-Zip\b/i, fornecedor: '7-zip', produto: '7-zip', componentes: 2 },
  { programa: 'WinRAR', padrao: /^WinRAR\b/i, fornecedor: 'rarlab', produto: 'winrar', componentes: 2 },
  { programa: 'VLC media player', padrao: /^VLC media player\b/i, fornecedor: 'videolan', produto: 'vlc_media_player', componentes: 3 },
  { programa: 'Notepad++', padrao: /^Notepad\+\+/i, fornecedor: 'notepad-plus-plus', produto: 'notepad\\+\\+', componentes: 3 },
  { programa: 'PuTTY', padrao: /^PuTTY\b/i, fornecedor: 'putty', produto: 'putty', componentes: 2 },
  { programa: 'WinSCP', padrao: /^WinSCP\b/i, fornecedor: 'winscp', produto: 'winscp', componentes: 3 },
  { programa: 'FileZilla', padrao: /^FileZilla( Client)?\b/i, fornecedor: 'filezilla-project', produto: 'filezilla_client', componentes: 3 },
  { programa: 'Wireshark', padrao: /^Wireshark\b/i, fornecedor: 'wireshark', produto: 'wireshark', componentes: 3 },
  { programa: 'KeePass', padrao: /^KeePass Password Safe\b/i, fornecedor: 'keepass', produto: 'keepass', componentes: 2 },
  { programa: 'Git', padrao: /^Git( version [\d.]+)?$/i, fornecedor: 'git-scm', produto: 'git', componentes: 3 },
  { programa: 'Node.js', padrao: /^Node\.js$/i, fornecedor: 'nodejs', produto: 'node.js', componentes: 3 },
  { programa: 'LibreOffice', padrao: /^LibreOffice\b/i, fornecedor: 'libreoffice', produto: 'libreoffice', componentes: 3 },
  { programa: 'TeamViewer', padrao: /^TeamViewer\b/i, fornecedor: 'teamviewer', produto: 'teamviewer', componentes: 3 },
  { programa: 'AnyDesk', padrao: /^AnyDesk$/i, fornecedor: 'anydesk', produto: 'anydesk', componentes: 3 },
  { programa: 'OpenVPN', padrao: /^OpenVPN\b/i, fornecedor: 'openvpn', produto: 'openvpn', componentes: 3 },
];

/**
 * Versao como o NVD escreve: so os componentes numericos do inicio, cortados em `componentes`
 * quando a linha da tabela diz ("0.81.0.0" -> "0.81"; "2.6.12-I001" -> "2.6.12"). null quando
 * a versao nao comeca por numero (nao da para montar um CPE confiavel).
 */
export function versaoCpe(versao: string, componentes?: number): string | null {
  const m = versao.trim().match(/^\d+(\.\d+)*/);
  if (!m) return null;
  const partes = m[0].split('.');
  return (componentes ? partes.slice(0, componentes) : partes).join('.');
}

/** Linha da tabela + CPE completo do programa instalado, ou null (fora da tabela ou sem versao). */
export function cpeDoPrograma(nome: string, versao: string): { programa: string; versao: string; cpe: string } | null {
  const linha = TABELA_CPE_WINDOWS.find((l) => l.padrao.test(nome.trim()));
  if (!linha) return null;
  const v = versaoCpe(versao, linha.componentes);
  if (!v) return null;
  return { programa: linha.programa, versao: v, cpe: `cpe:2.3:a:${linha.fornecedor}:${linha.produto}:${v}:*:*:*:*:*:*:*` };
}
