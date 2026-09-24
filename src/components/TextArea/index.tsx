import { useState } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { colors } from '../../theme';
import { styles } from './styles';

interface TextAreaProps extends TextInputProps {
  invalid?: boolean;
}

/** Área de texto multilinha em IBM Plex Mono (lista de e-mails). */
export function TextArea({ invalid, style, onFocus, onBlur, ...rest }: TextAreaProps) {
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      multiline
      textAlignVertical="top"
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
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
