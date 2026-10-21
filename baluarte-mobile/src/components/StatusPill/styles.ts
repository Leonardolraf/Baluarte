import { StyleSheet } from 'react-native';
import { radius, spacing, typography } from '../../theme';

const DOT_SIZE = 6;

export const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pill: {
    alignSelf: 'flex-start',
    height: 26,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  /** Lista da Home (variante `plain`): 13 px, como na captura 04. */
  label: {
    ...typography.labelSmall,
    marginRight: spacing.xxs,
  },
  /** Pílula dos Detalhes: 12 px, como nas capturas 06, 09, 10 e 12. */
  labelPill: {
    ...typography.badge,
  },
});
