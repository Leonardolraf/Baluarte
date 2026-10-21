import { LinearGradient } from 'expo-linear-gradient';
import { Text, View } from 'react-native';
import { getTemplate } from '../../data/templates';
import { campaignKpis } from '../../lib/campaigns';
import { formatDateTime } from '../../lib/format';
import { colors, iconStroke, icons } from '../../theme';
import type { Campaign } from '../../types';
import { BastionRings } from '../BastionRings';
import { KpiRow } from '../KpiRow';
import { StatusPill } from '../StatusPill';
import { styles } from './styles';

interface CampaignBannerProps {
  campaign: Campaign;
}

const GRADIENT = [colors.bg.surface, colors.bg.page] as const;

/** Banner dos Detalhes: status, agendamento, nome, grupo/modelo e KPIs sobre um degradê. */
export function CampaignBanner({ campaign }: CampaignBannerProps) {
  const template = getTemplate(campaign.template);

  return (
    <LinearGradient colors={GRADIENT} style={styles.container} testID="campaign-banner">
      <BastionRings scales={[11, 8, 5.2]} opacities={[0.7, 0.55, 0.4]} style={styles.rings} />

      <View style={styles.statusRow}>
        <StatusPill status={campaign.status} />
        <View style={styles.schedule}>
          <icons.Calendar size={16} color={colors.text.secondary} strokeWidth={iconStroke} />
          <Text style={styles.scheduleText}>Agendada para {formatDateTime(campaign.scheduledAt)}</Text>
        </View>
      </View>

      <Text style={styles.name} numberOfLines={2} accessibilityRole="header">
        {campaign.name}
      </Text>

      <Text style={styles.meta}>
        Grupo-alvo: <Text style={styles.metaValue}>{campaign.targetGroup}</Text>
        {' · '}Modelo: <Text style={styles.metaValue}>{template.label}</Text>
      </Text>

      <View style={styles.kpis}>
        <KpiRow items={campaignKpis(campaign)} />
      </View>
    </LinearGradient>
  );
}
