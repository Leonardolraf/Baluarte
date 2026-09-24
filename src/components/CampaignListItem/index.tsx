import { Pressable, Text, View } from 'react-native';
import { getTemplate } from '../../data/templates';
import { formatShortDateTime } from '../../lib/format';
import { CAMPAIGN_STATUS_LABEL } from '../../lib/labels';
import { colors, iconStroke, icons, layout, spacing, templateIcons } from '../../theme';
import type { Campaign } from '../../types';
import { ListDivider } from '../ListDivider';
import { StatusPill } from '../StatusPill';
import { dividerSpacing, styles } from './styles';

interface CampaignListItemProps {
  campaign: Campaign;
  onPress: () => void;
}

/** Linha da lista de campanhas: bloco do modelo, nome, modelo, data e status. */
export function CampaignListItem({ campaign, onPress }: CampaignListItemProps) {
  const template = getTemplate(campaign.template);
  const TemplateIcon = templateIcons[campaign.template];
  const schedule = formatShortDateTime(campaign.scheduledAt);

  return (
    <View>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${campaign.name}. Modelo ${template.label}. ${schedule}. ${CAMPAIGN_STATUS_LABEL[campaign.status]}.`}
        accessibilityHint="Abre os detalhes da campanha"
        testID={`campaign-item-${campaign.id}`}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.iconBlock}>
          <TemplateIcon size={28} color={colors.text.primary} strokeWidth={iconStroke} />
        </View>

        <View style={styles.content}>
          <View style={styles.line}>
            <Text style={styles.name} numberOfLines={1}>
              {campaign.name}
            </Text>
            <Text style={styles.template}>{template.label}</Text>
          </View>

          <View style={styles.line}>
            <View style={styles.schedule}>
              <icons.Calendar size={14} color={colors.text.secondary} strokeWidth={iconStroke} />
              <Text style={styles.scheduleText}>{schedule}</Text>
            </View>
            <StatusPill status={campaign.status} variant="plain" />
          </View>
        </View>
      </Pressable>
      <ListDivider
        inset={layout.iconBlock + spacing.lg}
        spacingTop={dividerSpacing.top}
        spacingBottom={dividerSpacing.bottom}
      />
    </View>
  );
}
