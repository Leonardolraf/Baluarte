import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { styles } from './styles';

interface ScreenProps {
  children: ReactNode;
  /**
   * Bordas que respeitam a área segura. Telas com `Header` usam só `bottom`:
   * o próprio cabeçalho pinta a área da barra de status.
   */
  edges?: readonly Edge[];
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Contêiner de toda tela: fundo `bg.page`, área segura e barra de status clara. */
export function Screen({ children, edges = ['top', 'bottom'], style, testID }: ScreenProps) {
  return (
    <SafeAreaView edges={edges} style={[styles.container, style]} testID={testID}>
      <StatusBar style="light" />
      {children}
    </SafeAreaView>
  );
}
