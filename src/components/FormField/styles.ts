import { StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    // Rótulo → controle: 6 px (DESIGN.md).
    marginBottom: 6,
  },
  label: {
    ...typography.label,
    color: colors.text.primary,
  },
  required: {
    color: colors.severity.critical,
  },
  /** Texto curto à direita do rótulo: 12 px, como na captura 05. */
  aside: {
    ...typography.caption,
    color: colors.text.secondary,
  },
  hint: {
    ...typography.caption,
    marginTop: 6,
    color: colors.text.secondary,
  },
  error: {
    ...typography.caption,
    fontFamily: typography.labelSmall.fontFamily,
    marginTop: 6,
    color: colors.text.error,
  },
});
