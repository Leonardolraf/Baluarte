import { StyleSheet } from 'react-native';
import { colors, layout, typography } from '../../theme';

export const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bg.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  content: {
    // A borda inferior (1 px) completa a altura do cabeçalho.
    height: layout.headerHeight - 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
  },
  side: {
    width: 40,
  },
  title: {
    ...typography.sectionTitle,
    flex: 1,
    color: colors.text.primary,
    textAlign: 'center',
  },
});
