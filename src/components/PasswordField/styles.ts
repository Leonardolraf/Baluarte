import { StyleSheet } from 'react-native';
import { spacing } from '../../theme';

export const styles = StyleSheet.create({
  toggle: {
    height: '100%',
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
