import type { ComponentType } from 'react';
import { RBAC_ROLES, type RBACRole } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLE_SEVERITY, ROUTE_ROLES, hasAnyRole } from '@/lib/roles';
import { initials } from '@/lib/format';
import {
  BaluarteMark,
  Card,
  KeyValueList,
  LinkButton,
  SeverityBadge,
  Table,
  TableContainer,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components';
import { BugIcon, DashboardIcon, InfoIcon, MailIcon, type IconProps } from '@/components/icons';

interface ModuleInfo {
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
  highlights: readonly string[];
}

const MODULES: readonly ModuleInfo[] = [
  {
    icon: BugIcon,
    title: 'Varredura de vulnerabilidades',
    description:
      'Analisa os ativos cadastrados em busca de falhas conhecidas e organiza o que foi encontrado por gravidade.',
    highlights: [
      'Cobertura do OWASP Top 10 2021',
      'Pontuação CVSS v3.1 para cada achado',
      'Relatórios com evidência e passos de remediação',
    ],
  },
  {
    icon: MailIcon,
    title: 'Phishing simulado',
    description:
      'Mede o risco humano com campanhas controladas, restritas a colaboradores internos da empresa.',
    highlights: [
      'Campanhas controladas, só para internos',
      'Rastreamento individual de envio, abertura e clique',
      'Treinamento contextual logo após o clique',
    ],
  },
  {
    icon: DashboardIcon,
    title: 'Dashboard unificado',
    description: 'Reúne o risco técnico das varreduras e o risco humano das campanhas num único painel.',
    highlights: [
      'Risco técnico e risco humano lado a lado',
      'Distribuição de achados por severidade',
      'Linha do tempo das ameaças recentes',
    ],
  },
];

interface TeamMember {
  name: string;
  responsibilities: readonly string[];
}

const TEAM: readonly TeamMember[] = [
  {
    name: 'Leonardo Rodrigues',
    responsibilities: ['Gestão do projeto', 'Cibersegurança', 'Engine OWASP', 'Segurança da API'],
  },
  {
    name: 'Edson Marcelino',
    responsibilities: ['Arquitetura', 'Modelagem de dados', 'Módulo de phishing'],
  },
];

const STACK: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Frontend', value: 'React 18 · TypeScript · TailwindCSS' },
  { label: 'Backend', value: 'Node.js · Express · TypeScript (API REST)' },
  { label: 'Banco de dados', value: 'PostgreSQL · Prisma' },
  { label: 'Autenticação', value: 'JWT RS256 · bcrypt · RBAC por middleware' },
  { label: 'Infraestrutura', value: 'Docker Compose · Nginx' },
];

type Area = keyof typeof ROUTE_ROLES;

const AREA_LABEL: Record<Area, string> = {
  dashboard: 'Dashboard',
  vulnerabilities: 'Vulnerabilidades',
  assets: 'Ativos',
  campaigns: 'Campanhas',
  training: 'Treinamentos',
  users: 'Usuários',
  settings: 'Configurações',
};

const AREAS: readonly Area[] = [
  'dashboard',
  'vulnerabilities',
  'assets',
  'campaigns',
  'training',
  'users',
  'settings',
];

/** Áreas de navegação liberadas para o perfil, derivadas da tabela de rotas. */
function allowedAreas(role: RBACRole): string {
  return AREAS.filter((area) => hasAnyRole(role, ROUTE_ROLES[area]))
    .map((area) => AREA_LABEL[area])
    .join(', ');
}

export default function AboutPage() {
  const { isAuthenticated } = useAuth();
  const ctaTo = isAuthenticated ? '/dashboard' : '/login';
  const ctaLabel = isAuthenticated ? 'Ir ao dashboard' : 'Entrar';

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
      <section aria-labelledby="about-title" className="flex flex-col items-start gap-6 sm:flex-row">
        <BaluarteMark size={64} />
        <div className="min-w-0">
          <p className="label-caps">Sobre o projeto</p>
          <h1 id="about-title" className="display mt-1 text-[28px] leading-8 text-ink dark:text-white">
            Baluarte
          </h1>
          <p className="mt-3 text-base text-slate-600 dark:text-slate-300">
            Plataforma de cibersegurança para empresas de médio porte. Reúne, num sistema só, a varredura de
            vulnerabilidades, a simulação de phishing e um painel unificado que mostra o risco técnico e o
            risco humano da organização.
          </p>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Trabalho de Conclusão de Curso em Engenharia de Software — Universidade Católica de Brasília
            (UCB).
          </p>
          <div className="mt-5">
            <LinkButton to={ctaTo}>{ctaLabel}</LinkButton>
          </div>
        </div>
      </section>

      <section aria-labelledby="modules-title" className="space-y-4">
        <h2 id="modules-title" className="text-lg font-semibold text-ink dark:text-white">
          O que o Baluarte faz
        </h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {MODULES.map((module) => {
            const Icon = module.icon;
            return (
              <Card key={module.title} as="article">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-200 text-ink dark:bg-slate-700 dark:text-white"
                  aria-hidden="true"
                >
                  <Icon size={20} />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-ink dark:text-white">{module.title}</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{module.description}</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                  {module.highlights.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span
                        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500"
                        aria-hidden="true"
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      </section>

      <Card
        title="Perfis de acesso (RBAC)"
        subtitle="Cada usuário recebe um perfil; a API responde 401 sem token e 403 fora do perfil autorizado."
        flush
      >
        <TableContainer bare>
          <Table>
            <THead>
              <tr>
                <Th>Perfil</Th>
                <Th>O que pode fazer</Th>
                <Th>Áreas liberadas</Th>
              </tr>
            </THead>
            <TBody>
              {RBAC_ROLES.map((role) => (
                <Tr key={role}>
                  <Td className="whitespace-nowrap">
                    <SeverityBadge severity={ROLE_SEVERITY[role]} label={ROLE_LABEL[role]} />
                  </Td>
                  <Td>{ROLE_DESCRIPTION[role]}</Td>
                  <Td className="text-slate-600 dark:text-slate-300">{allowedAreas(role)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Equipe" subtitle="Responsabilidades no projeto">
          <ul className="space-y-4">
            {TEAM.map((member) => (
              <li key={member.name} className="flex items-start gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  aria-hidden="true"
                >
                  {initials(member.name)}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink dark:text-white">{member.name}</p>
                  <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                    {member.responsibilities.join(' · ')}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Stack" subtitle="Arquitetura em três camadas, documentada no modelo 4+1">
          <KeyValueList
            items={STACK.map((entry) => ({ label: entry.label, value: entry.value, mono: true }))}
          />
        </Card>
      </div>

      <section
        role="note"
        aria-labelledby="scope-title"
        className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <span className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true">
          <InfoIcon size={18} />
        </span>
        <div>
          <p id="scope-title" className="font-semibold text-ink dark:text-white">
            Escopo desta versão
          </p>
          <p className="mt-1 text-slate-600 dark:text-slate-300">
            O scanner e o disparo de phishing são simulados: nenhum ataque real é executado e nenhum e-mail é
            enviado. Os dados exibidos servem para demonstrar o fluxo completo da plataforma.
          </p>
        </div>
      </section>
    </div>
  );
}
