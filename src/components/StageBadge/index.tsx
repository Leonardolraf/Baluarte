import { Text, View } from 'react-native';
import { RECIPIENT_STAGE_LABEL } from '../../lib/labels';
import { recipientStageTone } from '../../theme';
import type { RecipientStage } from '../../types';
import { styles } from './styles';

interface StageBadgeProps {
  stage: RecipientStage;
}

/** Etapa do destinatário (Reportou, Clicou…): ponto + texto na cor da etapa. */
export function StageBadge({ stage }: StageBadgeProps) {
  const tone = recipientStageTone[stage];
  const label = RECIPIENT_STAGE_LABEL[stage];

  return (
    <View style={styles.container} accessible accessibilityLabel={`Etapa: ${label}`}>
      <View style={[styles.dot, { backgroundColor: tone.dot }]} />
      <Text style={[styles.label, { color: tone.text }]}>{label}</Text>
    </View>
  );
}
