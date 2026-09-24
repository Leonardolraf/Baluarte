import { Text, View } from 'react-native';
import { styles } from './styles';

interface TagProps {
  label: string;
}

/** Pílula neutra (informativa, não é risco): ex. o tipo de ataque do treinamento. */
export function Tag({ label }: TagProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
