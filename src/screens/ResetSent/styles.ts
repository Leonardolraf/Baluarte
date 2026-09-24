import { StyleSheet } from 'react-native';
import { colors, layout, spacing, typography } from '../../theme';

const ICON_CIRCLE = 64;
/** Recuo inferior que sobe o bloco 40 px acima do centro geométrico (centro óptico, captura 03). */
const OPTICAL_CENTER_PADDING = 80;
/** Mensagem → dica (captura 03). */
const HINT_GAP = 28;

export const styles = StyleSheet.create({
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: OPTICAL_CENTER_PADDING,
  },
  iconCircle: {
    width: ICON_CIRCLE,
    height: ICON_CIRCLE,
    borderRadius: ICON_CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.success.border,
    backgroundColor: colors.success.background,
  },
  title: {
    ...typography.pageTitle,
    marginTop: spacing.xxl,
    color: colors.text.primary,
    textAlign: 'center',
  },
  message: {
    ...typography.body,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  hint: {
    ...typography.caption,
    lineHeight: 18,
    marginTop: HINT_GAP,
    paddingHorizontal: spacing.lg,
    color: colors.text.muted,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.lg,
  },
});
