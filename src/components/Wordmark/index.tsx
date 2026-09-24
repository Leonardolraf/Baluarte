import { Text, View } from 'react-native';
import { styles } from './styles';

interface WordmarkProps {
  /** Linha secundária em caixa alta (ex.: "PLATAFORMA DE CIBERSEGURANÇA"). */
  tagline?: string;
}

/** Nome "Baluarte" em Archivo 800 com a linha secundária opcional. */
export function Wordmark({ tagline }: WordmarkProps) {
  return (
    <View style={styles.container} accessible accessibilityRole="header">
      <Text style={styles.name}>Baluarte</Text>
      {tagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
    </View>
  );
}
