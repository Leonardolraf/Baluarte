import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildInitialCampaigns } from '../data/campaigns';
import { createScheduledCampaign, sortByScheduleDesc } from '../lib/campaigns';
import type { Campaign, NewCampaignInput } from '../types';

interface CampaignsContextValue {
  /** Sempre ordenadas pela data agendada, mais recente primeiro. */
  campaigns: Campaign[];
  getCampaign: (id: string) => Campaign | undefined;
  scheduleCampaign: (input: NewCampaignInput) => Campaign;
}

const CampaignsContext = createContext<CampaignsContextValue | null>(null);

interface CampaignsProviderProps {
  children: ReactNode;
  /** Lista inicial (útil em testes); por padrão, os dados do produto relativos a hoje. */
  initialCampaigns?: Campaign[];
}

export function CampaignsProvider({ children, initialCampaigns }: CampaignsProviderProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>(() =>
    sortByScheduleDesc(initialCampaigns ?? buildInitialCampaigns(new Date())),
  );
  // Próximo número de id (camp-006, camp-007…): continua depois dos dados iniciais.
  const nextNumber = useRef(campaigns.length + 1);

  const scheduleCampaign = useCallback((input: NewCampaignInput) => {
    const id = `camp-${String(nextNumber.current).padStart(3, '0')}`;
    nextNumber.current += 1;
    const campaign = createScheduledCampaign(input, id);
    setCampaigns((current) => sortByScheduleDesc([campaign, ...current]));
    return campaign;
  }, []);

  const getCampaign = useCallback(
    (id: string) => campaigns.find((campaign) => campaign.id === id),
    [campaigns],
  );

  const value = useMemo(
    () => ({ campaigns, getCampaign, scheduleCampaign }),
    [campaigns, getCampaign, scheduleCampaign],
  );

  return <CampaignsContext.Provider value={value}>{children}</CampaignsContext.Provider>;
}

export function useCampaigns(): CampaignsContextValue {
  const context = useContext(CampaignsContext);
  if (!context) throw new Error('useCampaigns precisa estar dentro de <CampaignsProvider>.');
  return context;
}
