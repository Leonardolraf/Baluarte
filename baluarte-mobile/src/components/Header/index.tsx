import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { layout } from '../../theme';
import { BackButton } from '../BackButton';
import { ToastOffset } from '../ToastOffset';
import { styles } from './styles';

interface HeaderProps {
  title: string;
  onBack?: () => void;
}

/** Cabeçalho das telas internas: superfície até a barra de status, voltar e título central. */
export function Header({ title, onBack }: HeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Enquanto a tela dele está em foco, o toast aparece logo abaixo do cabeçalho. */}
      <ToastOffset offset={layout.headerHeight} />
      <View style={styles.content}>
        <View style={styles.side}>{onBack ? <BackButton onPress={onBack} /> : null}</View>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        <View style={styles.side} />
      </View>
    </View>
  );
}
