import type { ReactNode } from 'react';
import type { RBACRole } from '@/types';
import { ROUTE_ROLES } from '@/lib/roles';
import {
  BugIcon,
  DashboardIcon,
  MailIcon,
  PlusIcon,
  ServerIcon,
  SettingsIcon,
  UsersIcon,
} from '@/components/icons';

export interface NavItem {
  to: string;
  label: string;
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
        label: 'Dashboard',
        icon: <DashboardIcon />,
        roles: ROUTE_ROLES.dashboard,
        end: true,
      },
      {
        to: '/vulnerabilities',
        label: 'Vulnerabilidades',
        icon: <BugIcon />,
        roles: ROUTE_ROLES.vulnerabilities,
      },
      { to: '/assets/new', label: 'Cadastrar ativo', icon: <ServerIcon />, roles: ROUTE_ROLES.assets },
    ],
  },
  {
    title: 'Conscientização',
    items: [
      { to: '/campaigns', label: 'Campanhas', icon: <MailIcon />, roles: ROUTE_ROLES.campaigns, end: true },
      { to: '/campaigns/new', label: 'Nova campanha', icon: <PlusIcon />, roles: ROUTE_ROLES.campaigns },
    ],
  },
  {
    title: 'Administração',
    items: [
      { to: '/users', label: 'Usuários', icon: <UsersIcon />, roles: ROUTE_ROLES.users },
      { to: '/settings', label: 'Configurações', icon: <SettingsIcon />, roles: ROUTE_ROLES.settings },
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
