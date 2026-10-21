import { StyleSheet } from 'react-native';
import { typography } from '../../theme';

const DOT_SIZE = 6;

export const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  label: {
    ...typography.labelSmall,
  },
});
