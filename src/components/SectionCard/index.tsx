import type { ReactNode } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { styles } from './styles';

interface SectionCardProps {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Cartão de conteúdo (raio 12, padding 16) com título em Archivo e subtítulo opcional. */
export function SectionCard({ title, subtitle, children, style }: SectionCardProps) {
  return (
    <View style={[styles.card, style]}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}
