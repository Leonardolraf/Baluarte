import { StyleSheet } from 'react-native';
import { colors, layout, spacing, typography } from '../../theme';

/** Largura da "/" e dos ":" entre as caixas de 48 px (captura 05: grupos de 48 + 13 + 48). */
const DATE_SEPARATOR_WIDTH = 13;

export const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    paddingTop: spacing.lg,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.md,
    gap: spacing.lg,
  },
  scheduleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  separator: {
    ...typography.bodyLarge,
    width: DATE_SEPARATOR_WIDTH,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  scheduleHint: {
    ...typography.caption,
    marginTop: 6,
    color: colors.text.secondary,
  },
  scheduleError: {
    ...typography.caption,
    fontFamily: typography.labelSmall.fontFamily,
    marginTop: 6,
    color: colors.text.error,
  },
});
