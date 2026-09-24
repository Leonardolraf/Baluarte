import { StyleSheet } from 'react-native';
import { colors, layout, radius, spacing, typography } from '../../theme';

/** As linhas se repetem a cada 96 px (captura 04): bloco de 64, respiro, divisória de 1 px e 12 px. */
const ROW_PITCH = 96;
const DIVIDER = 1;

/** Espaço acima e abaixo da divisória: 12 px até a próxima linha e o resto do passo (19 px) acima. */
export const dividerSpacing = {
  top: ROW_PITCH - layout.iconBlock - DIVIDER - spacing.md,
  bottom: spacing.md,
} as const;

export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  iconBlock: {
    width: layout.iconBlock,
    height: layout.iconBlock,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.sm,
    backgroundColor: colors.bg.surface,
  },
  content: {
    flex: 1,
    marginLeft: spacing.lg,
    gap: spacing.sm,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  name: {
    ...typography.strong,
    flex: 1,
    color: colors.text.primary,
  },
  template: {
    ...typography.bodySmall,
    color: colors.text.secondary,
  },
  schedule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scheduleText: {
    ...typography.bodySmall,
    color: colors.text.secondary,
  },
});
