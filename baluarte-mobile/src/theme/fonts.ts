/**
 * Arquivos de fonte carregados por `useFonts` em App.tsx. Cada peso é importado
 * pelo subcaminho para não empacotar os pesos que o app não usa.
 */
import { Archivo_500Medium } from '@expo-google-fonts/archivo/500Medium';
import { Archivo_700Bold } from '@expo-google-fonts/archivo/700Bold';
import { Archivo_800ExtraBold } from '@expo-google-fonts/archivo/800ExtraBold';
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono/400Regular';
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular';
import { IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans/500Medium';
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold';
import { fonts } from './typography';

export const fontSources = {
  [fonts.displayMedium]: Archivo_500Medium,
  [fonts.displayBold]: Archivo_700Bold,
  [fonts.displayExtraBold]: Archivo_800ExtraBold,
  [fonts.bodyRegular]: IBMPlexSans_400Regular,
  [fonts.bodyMedium]: IBMPlexSans_500Medium,
  [fonts.bodySemiBold]: IBMPlexSans_600SemiBold,
  [fonts.mono]: IBMPlexMono_400Regular,
};
