import { useState, type ReactNode, type Ref } from 'react';
import { TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { colors } from '../../theme';
import { styles } from './styles';

export interface TextFieldProps extends TextInputProps {
  invalid?: boolean;
  /** Elemento à direita dentro da caixa (ex.: o olho do PasswordField). */
  rightAccessory?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  ref?: Ref<TextInput>;
}

/** Campo de texto de 44 px com borda `border.input`, foco e estado inválido. */
export function TextField({
  invalid,
  rightAccessory,
  containerStyle,
  style,
  onFocus,
  onBlur,
  ref,
  ...rest
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View
      style={[
        styles.container,
        focused && styles.focused,
        invalid && styles.invalid,
        containerStyle,
      ]}
    >
      <TextInput
        ref={ref}
        style={[styles.input, style]}
        placeholderTextColor={colors.text.muted}
        selectionColor={colors.text.primary}
        cursorColor={colors.text.primary}
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
      {rightAccessory}
    </View>
  );
}
