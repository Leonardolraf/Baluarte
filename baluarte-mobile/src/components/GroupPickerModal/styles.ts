import { StyleSheet } from 'react-native';
import { colors, layout, radius, spacing, typography } from '../../theme';

/** Cabeçalho de 64 px até a primeira divisória (captura 08); a borda de 1 px da primeira linha completa a altura. */
const HEADER_HEIGHT = 64;
const ROW_BORDER = 1;
/** Linhas de 48 px, a mesma altura dos botões. */
const ROW_HEIGHT = layout.buttonHeight;
/** Respiro abaixo da última linha (captura 08). */
const LIST_BOTTOM = 10;

export const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: layout.screenPadding,
    backgroundColor: colors.bg.overlay,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    width: '100%',
    maxWidth: layout.modalMaxWidth,
    paddingBottom: LIST_BOTTOM,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.lg,
    backgroundColor: colors.bg.surface,
    boxShadow: '0px 24px 48px rgba(0, 0, 0, 0.45)',
  },
  header: {
    height: HEADER_HEIGHT - ROW_BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.text.primary,
  },
  pressedIcon: {
    opacity: 0.6,
  },
  list: {
    paddingHorizontal: spacing.xl,
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: ROW_BORDER,
    borderTopColor: colors.border.default,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowLabel: {
    ...typography.label,
    fontSize: 15,
    color: colors.text.primary,
  },
  rowLabelSelected: {
    fontFamily: typography.strong.fontFamily,
  },
});
