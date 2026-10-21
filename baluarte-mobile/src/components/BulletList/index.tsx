import { Text, View } from 'react-native';
import { iconStroke, type LucideIcon } from '../../theme';
import { styles } from './styles';

interface BulletListProps {
  items: readonly string[];
  icon: LucideIcon;
  iconColor: string;
}

/** Lista com ícone por item (sinais de alerta, boas práticas). */
export function BulletList({ items, icon: Icon, iconColor }: BulletListProps) {
  return (
    <View style={styles.list} accessibilityRole="list">
      {items.map((item) => (
        <View key={item} style={styles.item}>
          <Icon size={16} color={iconColor} strokeWidth={iconStroke} style={styles.icon} />
          <Text style={styles.text}>{item}</Text>
        </View>
      ))}
    </View>
  );
}
