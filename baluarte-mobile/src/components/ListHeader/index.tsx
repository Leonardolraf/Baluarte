import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { styles } from './styles';

interface ListHeaderProps {
  title: string;
  /** Texto à direita (ex.: "Total 5"). */
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
}

/** Título de lista em Archivo com um contador à direita. */
export function ListHeader({ title, subtitle, style }: ListHeaderProps) {
  return (
    <View style={[styles.container, style]}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}
