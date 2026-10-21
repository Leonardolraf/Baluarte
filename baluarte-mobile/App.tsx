import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProviders } from './src/contexts';
import { Routes } from './src/routes';
import { colors } from './src/theme';
import { fontSources } from './src/theme/fonts';

// Mantém a splash (fundo #0B1220 + marca) até as fontes carregarem.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  const [fontsLoaded, fontError] = useFonts(fontSources);
  // Se uma fonte falhar, o app segue com a fonte do sistema em vez de travar na splash.
  const ready = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  if (!ready) return null;

  return (
    <View style={styles.root}>
      <SafeAreaProvider style={styles.frame}>
        <StatusBar style="light" />
        <AppProviders>
          <Routes />
        </AppProviders>
      </SafeAreaProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg.page,
  },
  // No navegador o app vira uma coluna de celular centralizada; no aparelho ocupa a tela toda.
  frame: {
    flex: 1,
    width: '100%',
    ...(Platform.OS === 'web' ? { maxWidth: 480, alignSelf: 'center' as const } : null),
    backgroundColor: colors.bg.page,
  },
});
