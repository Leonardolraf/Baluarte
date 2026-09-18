import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AppLayout } from '@/components/Layout/AppLayout';
import { PublicLayout } from '@/components/Layout/PublicLayout';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { ROUTE_ROLES } from '@/lib/roles';

// Páginas carregadas sob demanda (code-splitting por rota).
const LoginPage = lazy(() => import('@/pages/Auth/LoginPage'));
const ResetPasswordPage = lazy(() => import('@/pages/Auth/ResetPasswordPage'));
const AboutPage = lazy(() => import('@/pages/About/AboutPage'));
const DashboardPage = lazy(() => import('@/pages/Dashboard/DashboardPage'));
const VulnListPage = lazy(() => import('@/pages/Vulnerabilities/VulnListPage'));
const VulnDetailPage = lazy(() => import('@/pages/Vulnerabilities/VulnDetailPage'));
const AssetListPage = lazy(() => import('@/pages/Assets/AssetListPage'));
const AssetFormPage = lazy(() => import('@/pages/Assets/AssetFormPage'));
const CampaignListPage = lazy(() => import('@/pages/Campaigns/CampaignListPage'));
const CampaignFormPage = lazy(() => import('@/pages/Campaigns/CampaignFormPage'));
const CampaignDetailPage = lazy(() => import('@/pages/Campaigns/CampaignDetailPage'));
const TrainingPage = lazy(() => import('@/pages/Training/TrainingPage'));
const TrainedCollaboratorsPage = lazy(() => import('@/pages/Training/TrainedCollaboratorsPage'));
const UserManagementPage = lazy(() => import('@/pages/Users/UserManagementPage'));
const UserFormPage = lazy(() => import('@/pages/Users/UserFormPage'));
const SettingsPage = lazy(() => import('@/pages/Settings/SettingsPage'));

function page(element: ReactNode): ReactNode {
  return <Suspense fallback={<LoadingSpinner label="Carregando página…" />}>{element}</Suspense>;
}

function NotFound() {
  return (
    <EmptyState
      title="Página não encontrada"
      description="O endereço acessado não existe ou foi movido."
      action={{ label: 'Ir para o dashboard', to: '/dashboard' }}
      className="min-h-[60vh]"
    />
  );
}

/**
 * Hierarquia de rotas.
 *  - Públicas: /login, /reset-password, /about
 *  - Protegidas (qualquer perfil): /dashboard, /training/:id, /settings
 *  - Admin + Analista: /vulnerabilities[/:id], /assets[/new], /trainings, /campaigns[/new|/:id]
 *  - Admin: /users, /users/new, /users/:id/edit
 */
export const routes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { path: '/login', element: page(<LoginPage />) },
      { path: '/reset-password', element: page(<ResetPasswordPage />) },
      { path: '/about', element: page(<AboutPage />) },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/dashboard', element: page(<DashboardPage />) },
          { path: '/training/:id', element: page(<TrainingPage />) },
          { path: '/settings', element: page(<SettingsPage />) },
          {
            element: <ProtectedRoute roles={ROUTE_ROLES.vulnerabilities} />,
            children: [
              { path: '/vulnerabilities', element: page(<VulnListPage />) },
              { path: '/vulnerabilities/:id', element: page(<VulnDetailPage />) },
              { path: '/assets', element: page(<AssetListPage />) },
              { path: '/assets/new', element: page(<AssetFormPage />) },
              { path: '/trainings', element: page(<TrainedCollaboratorsPage />) },
              { path: '/campaigns', element: page(<CampaignListPage />) },
              { path: '/campaigns/new', element: page(<CampaignFormPage />) },
              { path: '/campaigns/:id', element: page(<CampaignDetailPage />) },
            ],
          },
          {
            element: <ProtectedRoute roles={ROUTE_ROLES.users} />,
            children: [
              { path: '/users', element: page(<UserManagementPage />) },
              { path: '/users/new', element: page(<UserFormPage />) },
              { path: '/users/:id/edit', element: page(<UserFormPage />) },
            ],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
  { path: '/', element: <Navigate to="/dashboard" replace /> },
];
