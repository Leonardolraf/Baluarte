import { describe, expect, it } from 'vitest';
import type { CampaignTemplate, Severity, VulnerabilityStatus } from '@/types';
import { SEVERITIES } from '@/types';
import { severityFromCvss } from '@/lib/severity';
import {
  MOCK_ASSETS,
  MOCK_CAMPAIGNS,
  MOCK_CREDENTIALS,
  MOCK_NOTIFICATION_PREFERENCES,
  MOCK_NOW,
  MOCK_RECIPIENTS,
  MOCK_SCANS,
  MOCK_SECURITY_POLICY,
  MOCK_TIMELINE,
  MOCK_TRAININGS,
  MOCK_USERS,
  MOCK_VULNERABILITIES,
} from '@/mocks/data';

const DAY_MS = 86_400_000;
const NOW_MS = new Date(MOCK_NOW).getTime();
const SHA256_RE = /^[0-9a-f]{64}$/;
const CVSS_VECTOR_RE =
  /^CVSS:3\.1\/AV:[NALP]\/AC:[LH]\/PR:[NLH]\/UI:[NR]\/S:[UC]\/C:[NLH]\/I:[NLH]\/A:[NLH]$/;
const OWASP_ID_RE = /^A(0[1-9]|10):2021$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const INTERNAL_EMAIL_RE = /^[a-z0-9.-]+@empresa\.com$/;

const TRAINING_BY_TEMPLATE: Record<CampaignTemplate, string> = {
  urgency: 'trn-urgency',
  authority: 'trn-authority',
  curiosity: 'trn-curiosity',
};

function ids(items: ReadonlyArray<{ id: string }>): string[] {
  return items.map((item) => item.id);
}

function isOpen(status: VulnerabilityStatus): boolean {
  return status !== 'resolved' && status !== 'accepted';
}

function daysBefore(iso: string): number {
  return (NOW_MS - new Date(iso).getTime()) / DAY_MS;
}

function rate(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

describe('mock de dados — invariantes', () => {
  it('MOCK_NOW é a âncora temporal esperada', () => {
    expect(MOCK_NOW).toBe('2026-09-10T12:00:00.000Z');
    expect(Number.isNaN(NOW_MS)).toBe(false);
  });

  describe('identificadores', () => {
    it.each([
      ['usuários', MOCK_USERS],
      ['ativos', MOCK_ASSETS],
      ['vulnerabilidades', MOCK_VULNERABILITIES],
      ['varreduras', MOCK_SCANS],
      ['campanhas', MOCK_CAMPAIGNS],
      ['destinatários', MOCK_RECIPIENTS],
      ['treinamentos', MOCK_TRAININGS],
      ['linha do tempo', MOCK_TIMELINE],
    ] as const)('%s têm ids únicos e não vazios', (_name, items) => {
      const list = ids(items);
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((id) => id.trim().length > 0)).toBe(true);
      expect(new Set(list).size).toBe(list.length);
    });

    it('segue a numeração sequencial do contrato', () => {
      expect(ids(MOCK_ASSETS)).toEqual([
        'asset-001',
        'asset-002',
        'asset-003',
        'asset-004',
        'asset-005',
        'asset-006',
      ]);
      expect(ids(MOCK_VULNERABILITIES)).toEqual(
        Array.from({ length: 14 }, (_, index) => `vuln-${String(index + 1).padStart(3, '0')}`),
      );
      expect(ids(MOCK_SCANS)).toEqual(['scan-001', 'scan-002', 'scan-003', 'scan-004', 'scan-005']);
      expect(ids(MOCK_CAMPAIGNS)).toEqual(['camp-001', 'camp-002', 'camp-003', 'camp-004', 'camp-005']);
    });
  });

  describe('credenciais e usuários', () => {
    it('cada credencial aponta para um usuário existente, ativo e com e-mail interno', () => {
      expect(MOCK_CREDENTIALS).toHaveLength(3);
      for (const credential of MOCK_CREDENTIALS) {
        const user = MOCK_USERS.find((candidate) => candidate.id === credential.userId);
        expect(user, `usuário ${credential.userId}`).toBeDefined();
        expect(user?.email).toBe(credential.email);
        expect(user?.status).toBe('active');
        expect(credential.email).toMatch(INTERNAL_EMAIL_RE);
        expect(credential.password.length).toBeGreaterThanOrEqual(8);
      }
    });

    it('as três credenciais cobrem um perfil cada', () => {
      const roles = MOCK_CREDENTIALS.map(
        (credential) => MOCK_USERS.find((user) => user.id === credential.userId)?.role,
      );
      expect(new Set(roles)).toEqual(new Set(['admin', 'analyst', 'collaborator']));
    });

    it('todos os usuários usam o domínio corporativo e e-mails únicos', () => {
      expect(MOCK_USERS).toHaveLength(8);
      const emails = MOCK_USERS.map((user) => user.email.toLowerCase());
      expect(new Set(emails).size).toBe(emails.length);
      expect(emails.every((email) => INTERNAL_EMAIL_RE.test(email))).toBe(true);
    });
  });

  describe('vulnerabilidades', () => {
    it('há 14 achados com a distribuição de severidade pedida', () => {
      expect(MOCK_VULNERABILITIES).toHaveLength(14);
      const distribution: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
      for (const vuln of MOCK_VULNERABILITIES) distribution[vuln.severity] += 1;
      expect(distribution).toEqual({ critical: 3, high: 4, medium: 4, low: 2, info: 1 });
    });

    it('tem a distribuição de status pedida', () => {
      const byStatus: Record<VulnerabilityStatus, number> = {
        open: 0,
        in_review: 0,
        remediating: 0,
        resolved: 0,
        accepted: 0,
      };
      for (const vuln of MOCK_VULNERABILITIES) byStatus[vuln.status] += 1;
      expect(byStatus).toEqual({ open: 7, in_review: 2, remediating: 2, resolved: 2, accepted: 1 });
    });

    it.each(MOCK_VULNERABILITIES.map((vuln) => [vuln.id, vuln] as const))(
      '%s: severity == severityFromCvss(base) e vetor CVSS válido',
      (_id, vuln) => {
        expect(vuln.cvss.version).toBe('3.1');
        expect(vuln.cvss.base).toBeGreaterThanOrEqual(0);
        expect(vuln.cvss.base).toBeLessThanOrEqual(10);
        expect(vuln.cvss.vector).toMatch(CVSS_VECTOR_RE);
        expect(vuln.severity).toBe(severityFromCvss(vuln.cvss.base));
        expect(SEVERITIES).toContain(vuln.severity);
      },
    );

    it.each(MOCK_VULNERABILITIES.map((vuln) => [vuln.id, vuln] as const))(
      '%s: aponta para um ativo existente com nome e host coerentes',
      (_id, vuln) => {
        const asset = MOCK_ASSETS.find((candidate) => candidate.id === vuln.assetId);
        expect(asset, `ativo ${vuln.assetId}`).toBeDefined();
        expect(vuln.assetName).toBe(asset?.name);
        expect(vuln.assetHost).toBe(asset?.host);
      },
    );

    it.each(MOCK_VULNERABILITIES.map((vuln) => [vuln.id, vuln] as const))(
      '%s: categoria OWASP, evidências, remediação, referências e histórico completos',
      (_id, vuln) => {
        expect(vuln.owaspId).toMatch(OWASP_ID_RE);
        expect(vuln.owaspCategory.trim().length).toBeGreaterThan(0);
        expect(vuln.title.trim().length).toBeGreaterThan(0);
        expect(vuln.description.trim().length).toBeGreaterThan(0);

        expect(vuln.evidence.length).toBeGreaterThanOrEqual(1);
        expect(vuln.evidence.length).toBeLessThanOrEqual(4);
        for (const evidence of vuln.evidence) {
          if (evidence.kind === 'hash') expect(evidence.content.trim()).toMatch(SHA256_RE);
        }

        expect(vuln.remediation.length).toBeGreaterThanOrEqual(1);
        expect(vuln.remediation.length).toBeLessThanOrEqual(4);
        const orders = vuln.remediation.map((step) => step.order);
        expect(orders).toEqual([...orders].sort((a, b) => a - b));

        expect(vuln.references.length).toBeGreaterThanOrEqual(1);
        expect(vuln.references.length).toBeLessThanOrEqual(3);
        expect(vuln.references.every((url) => url.startsWith('https://'))).toBe(true);

        expect(vuln.history.some((entry) => entry.action === 'detected')).toBe(true);
        if (vuln.cve) expect(vuln.cve).toMatch(/^CVE-\d{4}-\d{4,}$/);
        if (vuln.artifactHash) expect(vuln.artifactHash).toMatch(SHA256_RE);
      },
    );

    it('detectedAt fica entre 1 e 40 dias antes de MOCK_NOW e updatedAt não é anterior', () => {
      for (const vuln of MOCK_VULNERABILITIES) {
        const age = daysBefore(vuln.detectedAt);
        expect(age, vuln.id).toBeGreaterThanOrEqual(1);
        expect(age, vuln.id).toBeLessThanOrEqual(40);
        expect(new Date(vuln.updatedAt).getTime(), vuln.id).toBeGreaterThanOrEqual(
          new Date(vuln.detectedAt).getTime(),
        );
      }
    });

    it('inclui os CVEs obrigatórios com CVSS oficial', () => {
      const byCve = new Map(MOCK_VULNERABILITIES.filter((vuln) => vuln.cve).map((vuln) => [vuln.cve, vuln]));
      expect(byCve.get('CVE-2021-44228')?.cvss).toEqual({
        version: '3.1',
        vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H',
        base: 10,
      });
      expect(byCve.get('CVE-2024-3094')?.cvss.base).toBe(10);
      expect(byCve.get('CVE-2024-6387')?.cvss.base).toBe(8.1);
      expect(byCve.get('CVE-2023-44487')?.cvss.base).toBe(7.5);
      expect(byCve.get('CVE-2019-10744')?.cvss.base).toBe(9.1);
      expect(byCve.get('CVE-2019-10744')?.severity).toBe('critical');
    });
  });

  describe('ativos', () => {
    it('openFindings bate com os achados não resolvidos/aceitos de cada ativo', () => {
      expect(MOCK_ASSETS).toHaveLength(6);
      for (const asset of MOCK_ASSETS) {
        const expected = MOCK_VULNERABILITIES.filter(
          (vuln) => vuln.assetId === asset.id && isOpen(vuln.status),
        ).length;
        expect(asset.openFindings, asset.id).toBe(expected);
      }
    });
  });

  describe('varreduras', () => {
    it('findingsBySeverity soma findingsCount e o scanner é o motor Baluarte', () => {
      expect(MOCK_SCANS).toHaveLength(5);
      for (const scan of MOCK_SCANS) {
        const sum = SEVERITIES.reduce((total, severity) => total + scan.findingsBySeverity[severity], 0);
        expect(sum, scan.id).toBe(scan.findingsCount);
        expect(scan.scanner).toBe('Baluarte OWASP Engine 1.4');
        expect(
          MOCK_ASSETS.some((asset) => asset.id === scan.assetId),
          scan.id,
        ).toBe(true);
      }
      const statuses = MOCK_SCANS.map((scan) => scan.status);
      expect(statuses.filter((status) => status === 'completed')).toHaveLength(4);
      expect(statuses.filter((status) => status === 'running')).toHaveLength(1);
    });
  });

  describe('campanhas', () => {
    const measured = MOCK_CAMPAIGNS.filter((campaign) => campaign.metrics.sent > 0);

    it('há 5 campanhas, sendo 4 com envios e 1 agendada sem envios', () => {
      expect(MOCK_CAMPAIGNS).toHaveLength(5);
      expect(measured).toHaveLength(4);
      const scheduled = MOCK_CAMPAIGNS.find((campaign) => campaign.status === 'scheduled');
      expect(scheduled?.metrics.sent).toBe(0);
      expect(scheduled?.metrics.clickRate).toBe(0);
    });

    it.each(measured.map((campaign) => [campaign.id, campaign] as const))(
      '%s: taxa de clique entre 8%% e 35%%',
      (_id, campaign) => {
        expect(campaign.metrics.clickRate).toBeGreaterThanOrEqual(8);
        expect(campaign.metrics.clickRate).toBeLessThanOrEqual(35);
      },
    );

    it.each(MOCK_CAMPAIGNS.map((campaign) => [campaign.id, campaign] as const))(
      '%s: métricas internamente coerentes',
      (_id, campaign) => {
        const m = campaign.metrics;
        expect(m.sent).toBeLessThanOrEqual(m.recipients);
        expect(m.opened).toBeLessThanOrEqual(m.sent);
        expect(m.clicked).toBeLessThanOrEqual(m.opened);
        expect(m.submitted).toBeLessThanOrEqual(m.clicked);
        expect(m.reported).toBeLessThanOrEqual(m.sent);
        expect(m.trained).toBeLessThanOrEqual(m.clicked);
        expect(m.openRate).toBe(rate(m.opened, m.sent));
        expect(m.clickRate).toBe(rate(m.clicked, m.sent));
        expect(m.submitRate).toBe(rate(m.submitted, m.sent));
        expect(m.reportRate).toBe(rate(m.reported, m.sent));
        expect(m.trainedRate).toBe(rate(m.trained, m.clicked));
      },
    );

    it('createdBy referencia nomes de MOCK_USERS', () => {
      const names = new Set(MOCK_USERS.map((user) => user.name));
      for (const campaign of MOCK_CAMPAIGNS) {
        expect(names.has(campaign.createdBy), campaign.id).toBe(true);
      }
    });
  });

  describe('destinatários', () => {
    it('cada campanha com envios tem entre 12 e 20 destinatários; a agendada não tem nenhum', () => {
      for (const campaign of MOCK_CAMPAIGNS) {
        const rows = MOCK_RECIPIENTS.filter((recipient) => recipient.campaignId === campaign.id);
        if (campaign.metrics.sent > 0) {
          expect(rows.length, campaign.id).toBeGreaterThanOrEqual(12);
          expect(rows.length, campaign.id).toBeLessThanOrEqual(20);
        } else {
          expect(rows, campaign.id).toHaveLength(0);
        }
      }
    });

    it.each(MOCK_RECIPIENTS.map((recipient) => [recipient.id, recipient] as const))(
      '%s: campanha existente, e-mail interno, cadeia temporal e treinamento coerentes',
      (_id, recipient) => {
        const campaign = MOCK_CAMPAIGNS.find((candidate) => candidate.id === recipient.campaignId);
        expect(campaign, `campanha ${recipient.campaignId}`).toBeDefined();
        if (!campaign) return;

        expect(recipient.email).toMatch(INTERNAL_EMAIL_RE);
        expect(recipient.name.trim().length).toBeGreaterThan(0);
        expect(['Financeiro', 'TI', 'RH', 'Comercial', 'Operações']).toContain(recipient.department);

        const sent = recipient.sentAt ? new Date(recipient.sentAt).getTime() : null;
        const opened = recipient.openedAt ? new Date(recipient.openedAt).getTime() : null;
        const clicked = recipient.clickedAt ? new Date(recipient.clickedAt).getTime() : null;
        const submitted = recipient.submittedAt ? new Date(recipient.submittedAt).getTime() : null;
        const reported = recipient.reportedAt ? new Date(recipient.reportedAt).getTime() : null;

        expect(sent).not.toBeNull();
        if (opened !== null) expect(opened).toBeGreaterThanOrEqual(sent ?? 0);
        if (clicked !== null) {
          expect(opened).not.toBeNull();
          expect(clicked).toBeGreaterThanOrEqual(opened ?? 0);
        }
        if (submitted !== null) {
          expect(clicked).not.toBeNull();
          expect(submitted).toBeGreaterThanOrEqual(clicked ?? 0);
        }
        if (reported !== null) expect(reported).toBeGreaterThanOrEqual(sent ?? 0);

        // Treinamento contextual só existe para quem clicou; o id segue o template da campanha.
        if (recipient.trainingId) {
          expect(recipient.trainingId).toBe(TRAINING_BY_TEMPLATE[campaign.template]);
        }
        if (recipient.trainingCompleted) {
          expect(clicked).not.toBeNull();
          expect(recipient.trainingId).toBe(TRAINING_BY_TEMPLATE[campaign.template]);
        }
      },
    );
  });

  describe('treinamentos', () => {
    it('tem exatamente os ids trn-urgency, trn-authority e trn-curiosity', () => {
      expect(ids(MOCK_TRAININGS)).toEqual(['trn-urgency', 'trn-authority', 'trn-curiosity']);
    });

    it('módulos US-005/006/007, duração 8–12 min, sem progresso e com conteúdo educativo', () => {
      const byId = new Map(MOCK_TRAININGS.map((training) => [training.id, training]));
      expect(byId.get('trn-urgency')?.moduleCode).toBe('US-005');
      expect(byId.get('trn-authority')?.moduleCode).toBe('US-006');
      expect(byId.get('trn-curiosity')?.moduleCode).toBe('US-007');

      for (const training of MOCK_TRAININGS) {
        expect(training.durationMin, training.id).toBeGreaterThanOrEqual(8);
        expect(training.durationMin, training.id).toBeLessThanOrEqual(12);
        expect(training.progress, training.id).toBe(0);
        expect(training.completed, training.id).toBe(false);
        expect(training.sections.length, training.id).toBeGreaterThanOrEqual(3);
        expect(training.sections.length, training.id).toBeLessThanOrEqual(4);
        expect(training.warningSigns.length, training.id).toBeGreaterThanOrEqual(3);
        expect(training.warningSigns.length, training.id).toBeLessThanOrEqual(5);
        expect(training.bestPractices.length, training.id).toBeGreaterThanOrEqual(3);
        expect(training.bestPractices.length, training.id).toBeLessThanOrEqual(5);
        for (const section of training.sections) {
          expect(section.heading.trim().length, training.id).toBeGreaterThan(0);
          expect(section.body.trim().length, training.id).toBeGreaterThan(0);
        }
      }
    });

    it('campaignId aponta para uma campanha com o template correspondente', () => {
      for (const training of MOCK_TRAININGS) {
        const campaign = MOCK_CAMPAIGNS.find((candidate) => candidate.id === training.campaignId);
        expect(campaign, training.id).toBeDefined();
        expect(campaign && TRAINING_BY_TEMPLATE[campaign.template], training.id).toBe(training.id);
      }
    });
  });

  describe('linha do tempo', () => {
    it('tem 12 eventos nos últimos 10 dias, com hrefs apontando para rotas conhecidas', () => {
      expect(MOCK_TIMELINE).toHaveLength(12);
      const kinds = new Set(MOCK_TIMELINE.map((event) => event.kind));
      expect(kinds.size).toBeGreaterThanOrEqual(4);
      for (const event of MOCK_TIMELINE) {
        expect(event.at, event.id).toMatch(ISO_DATE_RE);
        const age = daysBefore(event.at);
        expect(age, event.id).toBeGreaterThanOrEqual(0);
        expect(age, event.id).toBeLessThanOrEqual(10);
        if (event.kind === 'finding') expect(event.severity, event.id).toBeDefined();
        if (event.href)
          expect(event.href, event.id).toMatch(
            /^\/(vulnerabilities|campaigns|training|users|settings|dashboard)/,
          );
      }
    });
  });

  describe('configurações', () => {
    it('política de segurança e preferências de notificação seguem o contrato', () => {
      expect(MOCK_SECURITY_POLICY).toMatchObject({
        passwordMinLength: 8,
        requireMixedCase: true,
        requireNumberAndSymbol: true,
      });
      expect(MOCK_NOTIFICATION_PREFERENCES).toEqual({
        emailAlerts: true,
        criticalOnly: false,
        weeklyDigest: true,
        campaignReports: true,
      });
    });
  });
});
