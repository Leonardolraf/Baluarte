import { StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
  },
  item: {
    flex: 1,
  },
  value: {
    ...typography.numeral,
    color: colors.text.primary,
  },
  label: {
    ...typography.capsSmall,
    marginTop: spacing.xs,
    color: colors.text.secondary,
  },
});
