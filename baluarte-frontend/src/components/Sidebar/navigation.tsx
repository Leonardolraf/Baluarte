import type { ReactNode } from 'react';
import type { RBACRole } from '@/types';
import { ROUTE_ROLES } from '@/lib/roles';
import {
  ActivityIcon,
  BugIcon,
  ClockIcon,
  DashboardIcon,
  EyeIcon,
  FileScanIcon,
  GraduationIcon,
  MailIcon,
  MonitorIcon,
  PlusIcon,
  ServerIcon,
  SettingsIcon,
  UsersIcon,
} from '@/components/icons';

export interface NavItem {
  to: string;
  label: string;
  /** Uma linha sobre o que a tela faz (sugestões da busca do topo). */
  description: string;
  icon: ReactNode;
  roles: readonly RBACRole[];
  /** `end` do NavLink (match exato). */
  end?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Análise',
    items: [
      {
        to: '/dashboard',
        description: 'Visão geral do risco técnico e do risco humano',
        label: 'Dashboard',
        icon: <DashboardIcon />,
        roles: ROUTE_ROLES.dashboard,
        end: true,
      },
      {
        to: '/vulnerabilities',
        description: 'Achados com nota CVSS, evidência, remediação e relatórios',
        label: 'Vulnerabilidades',
        icon: <BugIcon />,
        roles: ROUTE_ROLES.vulnerabilities,
      },
      {
        to: '/assets',
        description: 'Servidores, aplicações e estações monitorados, com nota de risco',
        label: 'Ativos',
        icon: <ServerIcon />,
        roles: ROUTE_ROLES.assets,
        end: true,
      },
      {
        to: '/assets/new',
        description: 'Registrar um novo ativo para varredura',
        label: 'Cadastrar ativo',
        icon: <PlusIcon />,
        roles: ROUTE_ROLES.assets,
      },
      {
        to: '/scans',
        description: 'Andamento e histórico das varreduras OWASP',
        label: 'Varreduras',
        icon: <ActivityIcon />,
        roles: ROUTE_ROLES.scans,
        end: true,
      },
      {
        to: '/stations',
        description: 'Estações com o agente instalado e o inventário de cada uma',
        label: 'Estações',
        icon: <MonitorIcon />,
        roles: ROUTE_ROLES.stations,
      },
      {
        to: '/files',
        description: 'Verificar um arquivo suspeito no antivírus',
        label: 'Análise de arquivos',
        icon: <FileScanIcon />,
        roles: ROUTE_ROLES.files,
        end: true,
      },
    ],
  },
  {
    title: 'Conscientização',
    items: [
      {
        to: '/campaigns',
        description: 'Campanhas de phishing simulado e os resultados de cada uma',
        label: 'Campanhas',
        icon: <MailIcon />,
        roles: ROUTE_ROLES.campaigns,
        end: true,
      },
      {
        to: '/campaigns/new',
        description: 'Criar e enviar uma campanha de phishing simulado',
        label: 'Nova campanha',
        icon: <PlusIcon />,
        roles: ROUTE_ROLES.campaigns,
      },
      {
        to: '/trainings',
        description: 'Colaboradores que concluíram o treinamento',
        label: 'Treinamentos',
        icon: <GraduationIcon />,
        roles: ROUTE_ROLES.trainings,
        end: true,
      },
    ],
  },
  {
    title: 'Administração',
    items: [
      {
        to: '/users',
        description: 'Contas, perfis de acesso e convites',
        label: 'Usuários',
        icon: <UsersIcon />,
        roles: ROUTE_ROLES.users,
      },
      {
        to: '/audit',
        description: 'Trilha de ações registradas e verificação de integridade',
        label: 'Auditoria',
        icon: <ClockIcon />,
        roles: ROUTE_ROLES.audit,
      },
      {
        to: '/settings',
        description: 'Sua conta, senha e preferências',
        label: 'Configurações',
        icon: <SettingsIcon />,
        roles: ROUTE_ROLES.settings,
      },
      {
        to: '/monitoring',
        description: 'Aviso de monitoramento da estação e registro de ciência',
        label: 'Monitoramento',
        icon: <EyeIcon />,
        roles: ROUTE_ROLES.monitoring,
      },
    ],
  },
];

/** Filtra os grupos de navegação pelo perfil atual (grupos vazios são omitidos). */
export function navGroupsForRole(role: RBACRole | null | undefined): NavGroup[] {
  if (!role) return [];
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.includes(role)),
  })).filter((group) => group.items.length > 0);
}

/**
 * Locais que a busca do topo sugere ao perfil (#27): os mesmos itens do menu, já filtrados pelo
 * perfil. Não há lista paralela: item novo no menu aparece na busca, e quem decide o acesso é o
 * mesmo `ROUTE_ROLES` que protege a rota em `routes.tsx`.
 */
export function searchPlacesForRole(role: RBACRole | null | undefined): NavItem[] {
  return navGroupsForRole(role).flatMap((group) => group.items);
}

/** Minúsculas e sem acento, para a busca não diferenciar "Relatório" de "relatorio". */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Filtra os locais pelo texto digitado, no nome ou na descrição. Texto vazio devolve todos. */
export function filterPlaces(places: readonly NavItem[], query: string): NavItem[] {
  const needle = normalizeSearchText(query);
  if (!needle) return [...places];
  return places.filter(
    (place) =>
      normalizeSearchText(place.label).includes(needle) ||
      normalizeSearchText(place.description).includes(needle),
  );
}
