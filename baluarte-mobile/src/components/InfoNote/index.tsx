import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, iconStroke, icons } from '../../theme';
import { styles } from './styles';

interface InfoNoteProps {
  children: string;
  style?: StyleProp<ViewStyle>;
}

/** Aviso discreto com ícone de informação (ex.: campanha ainda não disparada). */
export function InfoNote({ children, style }: InfoNoteProps) {
  return (
    <View style={[styles.container, style]}>
      <icons.Info size={16} color={colors.text.secondary} strokeWidth={iconStroke} style={styles.icon} />
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}
