import type { ReactNode } from 'react';
import type { Campaign, User } from '../types';
import { AuthProvider } from './auth';
import { CampaignsProvider } from './campaigns';
import { ToastProvider } from './toast';
import { TrainingsProvider } from './trainings';

export { useAuth } from './auth';
export { useCampaigns } from './campaigns';
export { TOAST_DURATION_MS, useToast, useToastOffset } from './toast';
export { useTrainings } from './trainings';

interface AppProvidersProps {
  children: ReactNode;
  initialUser?: User | null;
  initialCampaigns?: Campaign[];
}

/** Estado global do app: sessão, campanhas, conclusão dos treinamentos e toast. */
export function AppProviders({ children, initialUser, initialCampaigns }: AppProvidersProps) {
  return (
    <AuthProvider initialUser={initialUser}>
      <CampaignsProvider initialCampaigns={initialCampaigns}>
        <TrainingsProvider>
          <ToastProvider>{children}</ToastProvider>
        </TrainingsProvider>
      </CampaignsProvider>
    </AuthProvider>
  );
}
