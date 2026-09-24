import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { BackButton, BaluarteMark, Button, FormField, Screen, TextField } from '../../components';
import { validateEmail } from '../../lib/validation';
import type { AuthScreenProps } from '../../types/navigation';
import { styles } from './styles';

export function ResetPasswordScreen({ navigation, route }: AuthScreenProps<'ResetPassword'>) {
  const [email, setEmail] = useState(route.params?.email ?? '');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    const nextError = validateEmail(email);
    setError(nextError);
    // Simulado: nada é enviado. A resposta é sempre neutra ("se ele existir"),
    // para não revelar quais e-mails estão cadastrados. `replace`: a pilha fica
    // Login → Solicitação enviada, e qualquer "voltar" leva ao Login, não ao formulário.
    if (!nextError) navigation.replace('ResetSent');
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
          <BackButton onPress={() => navigation.goBack()} />

          <View style={styles.mark}>
            <BaluarteMark size={48} />
          </View>

          <Text style={styles.title} accessibilityRole="header">
            Redefinir senha
          </Text>
          <Text style={styles.description}>
            Informe o e-mail cadastrado. Se ele existir, enviaremos um link para criar uma nova senha.
          </Text>

          <FormField label="E-mail" required error={error} style={styles.field}>
            <TextField
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                setError(null);
              }}
              placeholder="voce@empresa.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={handleSubmit}
              invalid={Boolean(error)}
              accessibilityLabel="E-mail"
            />
          </FormField>

          <Button title="Enviar link de redefinição" onPress={handleSubmit} style={styles.submit} />

          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
          >
            <Text style={styles.linkText}>Voltar ao login</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
