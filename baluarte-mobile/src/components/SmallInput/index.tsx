import { useState } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { colors } from '../../theme';
import { styles } from './styles';

interface SmallInputProps extends TextInputProps {
  invalid?: boolean;
}

/** Caixa numérica de 48×44 para dia, mês, hora e minuto. */
export function SmallInput({ invalid, style, onFocus, onBlur, ...rest }: SmallInputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      keyboardType="number-pad"
      maxLength={2}
      selectTextOnFocus
      placeholderTextColor={colors.text.muted}
      selectionColor={colors.text.primary}
      cursorColor={colors.text.primary}
      style={[styles.input, focused && styles.focused, invalid && styles.invalid, style]}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      {...rest}
    />
  );
}
