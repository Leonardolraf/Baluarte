import { Text, View } from 'react-native';
import { CAMPAIGN_STATUS_LABEL } from '../../lib/labels';
import { campaignStatusTone } from '../../theme';
import type { CampaignStatus } from '../../types';
import { styles } from './styles';

interface StatusPillProps {
  status: CampaignStatus;
  /** `pill` = com fundo e borda (Detalhes) · `plain` = só ponto + texto (lista da Home). */
  variant?: 'pill' | 'plain';
}

/** Status da campanha (Ativa, Agendada, Encerrada) nas cores de status do produto. */
export function StatusPill({ status, variant = 'pill' }: StatusPillProps) {
  const tone = campaignStatusTone[status];
  const label = CAMPAIGN_STATUS_LABEL[status];
  const isPill = variant === 'pill';

  return (
    <View
      style={[
        styles.container,
        isPill && [styles.pill, { backgroundColor: tone.background, borderColor: tone.border }],
      ]}
      accessible
      accessibilityLabel={`Status: ${label}`}
    >
      <View style={[styles.dot, { backgroundColor: tone.dot }]} />
      <Text style={[styles.label, isPill && styles.labelPill, { color: tone.text }]}>{label}</Text>
    </View>
  );
}
