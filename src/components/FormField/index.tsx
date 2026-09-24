import type { ReactNode } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { styles } from './styles';

interface FormFieldProps {
  label: string;
  required?: boolean;
  /** Texto de apoio abaixo do controle (some quando há erro). */
  hint?: string | null;
  /** Texto curto à direita do rótulo (ex.: "Somente @empresa.com"). */
  aside?: string;
  error?: string | null;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Rótulo (com `*` vermelho quando obrigatório) + controle + dica ou erro. */
export function FormField({ label, required, hint, aside, error, children, style }: FormFieldProps) {
  return (
    <View style={style}>
      <View style={styles.labelRow}>
        <Text
          style={styles.label}
          accessibilityLabel={required ? `${label}, obrigatório` : label}
        >
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
        {aside ? <Text style={styles.aside}>{aside}</Text> : null}
      </View>
      {children}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}
