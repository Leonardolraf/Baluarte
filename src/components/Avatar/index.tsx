import { Text, View } from 'react-native';
import { initials } from '../../lib/format';
import { styles } from './styles';

interface AvatarProps {
  name: string;
  size?: number;
}

/** Quadrado com as iniciais do nome ("Ana Almeida" -> "AA"). */
export function Avatar({ name, size = 48 }: AvatarProps) {
  return (
    <View style={[styles.container, { width: size, height: size }]} aria-hidden>
      <Text style={styles.initials}>{initials(name)}</Text>
    </View>
  );
}
