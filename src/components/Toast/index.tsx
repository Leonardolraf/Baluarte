import { useEffect, useRef } from 'react';
import { Animated, Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, iconStroke, icons, spacing } from '../../theme';
import { styles } from './styles';

interface ToastProps {
  message: string;
  /** Quanto descer além da área segura: a altura do cabeçalho da tela em foco, ou 0. */
  offset?: number;
}

/**
 * Aviso flutuante de sucesso no topo da tela em foco (abaixo do cabeçalho, quando
 * ela tem um). Quem controla quando aparece, some e onde fica é o ToastProvider
 * (contexts/toast.tsx).
 */
export function Toast({ message, offset = 0 }: ToastProps) {
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 180,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] });

  return (
    <View style={[styles.wrapper, { top: insets.top + offset + spacing.md }]} testID="toast-anchor">
      <Animated.View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID="toast"
        style={[styles.toast, { opacity: progress, transform: [{ translateY }] }]}
      >
        <icons.CircleCheck size={20} color={colors.success.text} strokeWidth={iconStroke} />
        <Text style={styles.message}>{message}</Text>
      </Animated.View>
    </View>
  );
}
