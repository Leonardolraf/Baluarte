import { useState } from 'react';
import { Pressable } from 'react-native';
import { colors, iconStroke, icons } from '../../theme';
import { TextField, type TextFieldProps } from '../TextField';
import { styles } from './styles';

type PasswordFieldProps = Omit<TextFieldProps, 'secureTextEntry' | 'rightAccessory'>;

/** TextField de senha com o olho que mostra/oculta o conteúdo. */
export function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const ToggleIcon = visible ? icons.EyeOff : icons.Eye;

  return (
    <TextField
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="current-password"
      textContentType="password"
      {...props}
      secureTextEntry={!visible}
      rightAccessory={
        <Pressable
          onPress={() => setVisible((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Ocultar senha' : 'Mostrar senha'}
          hitSlop={8}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
        >
          <ToggleIcon size={20} color={colors.text.secondary} strokeWidth={iconStroke} />
        </Pressable>
      }
    />
  );
}
