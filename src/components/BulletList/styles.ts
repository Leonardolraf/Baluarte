import { StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  list: {
    gap: spacing.md,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  icon: {
    marginTop: 2,
  },
  /** Mesmo corpo dos cartões do treinamento (13/20). */
  text: {
    ...typography.paragraph,
    flex: 1,
    color: colors.text.primary,
  },
});
