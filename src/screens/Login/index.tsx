import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  BaluarteMark,
  BastionRings,
  Button,
  ErrorBanner,
  FormField,
  PasswordField,
  Screen,
  TextField,
  Wordmark,
} from '../../components';
import { useAuth } from '../../contexts';
import { DEFAULT_LOGIN_EMAIL } from '../../data/users';
import { validateEmail, validatePassword } from '../../lib/validation';
import type { AuthScreenProps } from '../../types/navigation';
import { styles } from './styles';

interface LoginErrors {
  email?: string | null;
  password?: string | null;
}

export function LoginScreen({ navigation }: AuthScreenProps<'Login'>) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState(DEFAULT_LOGIN_EMAIL);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<LoginErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function handleSubmit() {
    if (submitting) return;
    const nextErrors: LoginErrors = {
      email: validateEmail(email),
      password: validatePassword(password),
    };
    setErrors(nextErrors);
    setFormError(null);
    if (nextErrors.email || nextErrors.password) return;

    // Sucesso: o AuthContext guarda o usuário e `routes/index.tsx` troca para a Home.
    setSubmitting(true);
    try {
      const result = await signIn(email, password);
      if (!result.ok) setFormError(result.error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brand}>
            <BastionRings>
              <BaluarteMark size={64} />
            </BastionRings>
            <View style={styles.wordmark}>
              <Wordmark tagline="PLATAFORMA DE CIBERSEGURANÇA" />
            </View>
          </View>

          <Text style={styles.title} accessibilityRole="header">
            Entrar no Baluarte
          </Text>
          <Text style={styles.subtitle}>
            Acesse o painel unificado de risco técnico e humano da sua empresa.
          </Text>

          <View style={styles.form}>
            <FormField label="E-mail" required error={errors.email}>
              <TextField
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  setErrors((current) => ({ ...current, email: null }));
                  setFormError(null);
                }}
                placeholder="voce@empresa.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                invalid={Boolean(errors.email)}
                accessibilityLabel="E-mail"
              />
            </FormField>

            <FormField label="Senha" required error={errors.password}>
              <PasswordField
                ref={passwordRef}
                value={password}
                onChangeText={(value) => {
                  setPassword(value);
                  setErrors((current) => ({ ...current, password: null }));
                  setFormError(null);
                }}
                placeholder="••••••••"
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
                invalid={Boolean(errors.password)}
                accessibilityLabel="Senha"
              />
            </FormField>
          </View>

          {formError ? (
            <View style={styles.formError}>
              <ErrorBanner message={formError} />
            </View>
          ) : null}

          <Button title="Entrar" onPress={handleSubmit} disabled={submitting} style={styles.submit} />

          <Pressable
            onPress={() => navigation.navigate('ResetPassword', { email: email.trim() })}
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
          >
            <Text style={styles.linkText}>Esqueci minha senha</Text>
          </Pressable>

          <View style={styles.spacer} />

          <Text style={styles.footer}>Perfis: Administrador · Analista · Colaborador</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
