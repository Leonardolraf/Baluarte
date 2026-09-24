import { StyleSheet } from 'react-native';
import { colors, layout, spacing, typography } from '../../theme';

/** Cards de modelo → título "Campanhas" (captura 04). */
const LIST_HEADER_GAP = 28;
const LIST_TOP = spacing.md;

/**
 * Bloco da saudação no topo da lista (respiro + linha do avatar e do botão +).
 * A Home informa essa altura ao toast, que aparece logo abaixo da saudação,
 * como aparece abaixo do cabeçalho nas outras telas.
 */
export const greetingBlockHeight = LIST_TOP + layout.avatar;

export const styles = StyleSheet.create({
  list: {
    paddingTop: LIST_TOP,
    paddingHorizontal: layout.screenPadding,
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  pressed: {
    opacity: 0.7,
  },
  greetingBox: {
    flex: 1,
  },
  greeting: {
    ...typography.greeting,
    color: colors.text.primary,
  },
  greetingName: {
    fontFamily: typography.greetingStrong.fontFamily,
  },
  role: {
    ...typography.bodySmall,
    marginTop: spacing.xxs,
    color: colors.text.secondary,
  },
  templates: {
    marginTop: spacing.xxxl,
  },
  listHeader: {
    marginTop: LIST_HEADER_GAP,
    marginBottom: spacing.lg,
  },
  empty: {
    ...typography.body,
    paddingVertical: spacing.xxl,
    color: colors.text.secondary,
    textAlign: 'center',
  },
});
