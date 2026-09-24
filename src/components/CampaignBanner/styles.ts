import { StyleSheet } from 'react-native';
import { colors, layout, spacing, typography } from '../../theme';

export const styles = StyleSheet.create({
  container: {
    minHeight: layout.bannerMinHeight,
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    overflow: 'hidden',
  },
  /** Pentágonos decorativos ancorados no canto superior direito do banner. */
  rings: {
    position: 'absolute',
    top: -46,
    right: -72,
  },
  /**
   * Pílula + agendamento ocupam ~307 px: cabem numa linha a partir de telas de 360 px.
   * Em telas mais estreitas o agendamento desce para a linha de baixo em vez de ser cortado.
   */
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 10,
    rowGap: spacing.sm,
  },
  schedule: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  /** 12 px, como nas capturas 10 e 12 ("Agendada para 18/10/2026 09:00" inteiro em 360 px). */
  scheduleText: {
    ...typography.caption,
    flexShrink: 1,
    color: colors.text.secondary,
  },
  name: {
    ...typography.campaignName,
    marginTop: spacing.sm,
    color: colors.text.primary,
  },
  meta: {
    ...typography.bodySmall,
    marginTop: spacing.xs,
    color: colors.text.secondary,
  },
  metaValue: {
    fontFamily: typography.labelSmall.fontFamily,
    color: colors.text.primary,
  },
  kpis: {
    marginTop: spacing.lg,
  },
});
