import { StyleSheet } from 'react-native';
import { colors, radius, typography } from '../../theme';

export const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.sm,
    backgroundColor: colors.bg.raised,
  },
  initials: {
    ...typography.initials,
    color: colors.text.primary,
  },
});
