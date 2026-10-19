import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { buildInitialCampaigns } from '../data/campaigns';
import { campaignRepository } from '../data/repository';
import { ApiError } from '../lib/api/client';
import { IS_API_MODE } from '../lib/config';
import { sortByScheduleDesc } from '../lib/campaigns';
import type { Campaign, NewCampaignInput } from '../types';

interface CampaignsContextValue {
  /** Sempre ordenadas pela data agendada, mais recente primeiro. */
  campaigns: Campaign[];
  /** `true` enquanto a lista carrega da API (modo API); nunca no modo demo. */
  loading: boolean;
  /** Mensagem de erro do carregamento da lista, ou `null`. */
  error: string | null;
  /**
   * `true` quando a API barra os dados por ciência do aviso pendente
   * (403 CIENCIA_AVISO_PENDENTE): a sessão é válida, mas falta a pessoa dar
   * ciência no portal web. A UI mostra orientação em vez de erro genérico.
   */
  noticePending: boolean;
  getCampaign: (id: string) => Campaign | undefined;
  /** No modo API, busca o detalhe completo (funil, destinatários) da campanha. */
  loadCampaignDetail: (id: string) => Promise<Campaign | undefined>;
  scheduleCampaign: (input: NewCampaignInput) => Promise<Campaign>;
  /** Recarrega a lista a partir da origem (usado depois de um erro). */
  reload: () => void;
}

const CampaignsContext = createContext<CampaignsContextValue | null>(null);

interface CampaignsProviderProps {
  children: ReactNode;
  /** Lista inicial (útil em testes); por padrão, os dados do produto relativos a hoje. */
  initialCampaigns?: Campaign[];
}

const LOAD_ERROR = 'Não foi possível carregar as campanhas.';

export function CampaignsProvider({ children, initialCampaigns }: CampaignsProviderProps) {
  // No modo demo (e nos testes) a lista já nasce pronta, síncrona. No modo API,
  // começa vazia e carrega no efeito abaixo.
  const [campaigns, setCampaigns] = useState<Campaign[]>(() => {
    if (initialCampaigns) return sortByScheduleDesc(initialCampaigns);
    return IS_API_MODE ? [] : sortByScheduleDesc(buildInitialCampaigns(new Date()));
  });
  const shouldFetch = IS_API_MODE && !initialCampaigns;
  const [loading, setLoading] = useState(shouldFetch);
  const [error, setError] = useState<string | null>(null);
  const [noticePending, setNoticePending] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!shouldFetch) return;
    let active = true;
    setLoading(true);
    setError(null);
    setNoticePending(false);
    campaignRepository
      .list()
      .then((list) => {
        if (active) setCampaigns(sortByScheduleDesc(list));
      })
      .catch((err) => {
        if (!active) return;
        // Ciência do aviso pendente: sessão válida, falta ato no portal — não é erro.
        if (err instanceof ApiError && err.code === 'CIENCIA_AVISO_PENDENTE') {
          setNoticePending(true);
        } else {
          setError(LOAD_ERROR);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [shouldFetch, reloadKey]);

  const getCampaign = useCallback(
    (id: string) => campaigns.find((campaign) => campaign.id === id),
    [campaigns],
  );

  const loadCampaignDetail = useCallback(
    async (id: string) => {
      if (!IS_API_MODE) return campaigns.find((campaign) => campaign.id === id);
      const detail = await campaignRepository.get(id);
      if (detail) {
        // Atualiza a cópia na lista para refletir o detalhe mais fresco.
        setCampaigns((current) =>
          current.some((c) => c.id === id)
            ? current.map((c) => (c.id === id ? detail : c))
            : current,
        );
      }
      return detail;
    },
    [campaigns],
  );

  const scheduleCampaign = useCallback(async (input: NewCampaignInput) => {
    const campaign = await campaignRepository.create(input);
    setCampaigns((current) => sortByScheduleDesc([campaign, ...current]));
    return campaign;
  }, []);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  const value = useMemo(
    () => ({
      campaigns,
      loading,
      error,
      noticePending,
      getCampaign,
      loadCampaignDetail,
      scheduleCampaign,
      reload,
    }),
    [campaigns, loading, error, noticePending, getCampaign, loadCampaignDetail, scheduleCampaign, reload],
  );

  return <CampaignsContext.Provider value={value}>{children}</CampaignsContext.Provider>;
}

export function useCampaigns(): CampaignsContextValue {
  const context = useContext(CampaignsContext);
  if (!context) throw new Error('useCampaigns precisa estar dentro de <CampaignsProvider>.');
  return context;
}
