import { fireEvent, screen } from '@testing-library/react-native';
import { renderApp } from '../../test-utils';

describe('Redefinir senha', () => {
  it('leva o e-mail do login, valida e confirma o envio', async () => {
    await renderApp();

    await fireEvent.press(screen.getByRole('button', { name: 'Esqueci minha senha' }));
    expect(await screen.findByText('Redefinir senha')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Informe o e-mail cadastrado. Se ele existir, enviaremos um link para criar uma nova senha.',
      ),
    ).toBeOnTheScreen();

    const email = screen.getAllByLabelText('E-mail').at(-1)!;
    expect(email).toHaveDisplayValue('admin@empresa.com');

    await fireEvent.changeText(email, '');
    await fireEvent.press(screen.getByRole('button', { name: 'Enviar link de redefinição' }));
    expect(screen.getByText('E-mail é obrigatório')).toBeOnTheScreen();

    await fireEvent.changeText(email, 'admin@');
    await fireEvent.press(screen.getByRole('button', { name: 'Enviar link de redefinição' }));
    expect(screen.getByText('Formato de e-mail inválido')).toBeOnTheScreen();

    await fireEvent.changeText(email, 'qualquer@empresa.com');
    await fireEvent.press(screen.getByRole('button', { name: 'Enviar link de redefinição' }));

    expect(await screen.findByText('Solicitação enviada')).toBeOnTheScreen();
    // A confirmação substituiu o formulário na pilha (Login → Solicitação enviada):
    // o "voltar" do Android ou do navegador leva ao Login, não de volta ao formulário.
    expect(
      screen.queryByText('Enviar link de redefinição', { includeHiddenElements: true }),
    ).not.toBeOnTheScreen();
    expect(
      screen.getByText(
        'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha em instantes.',
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Não recebeu? Verifique a caixa de spam ou aguarde alguns minutos antes de tentar de novo.',
      ),
    ).toBeOnTheScreen();
  });

  it('"Voltar ao login" da confirmação limpa a pilha', async () => {
    await renderApp();

    await fireEvent.press(screen.getByRole('button', { name: 'Esqueci minha senha' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Enviar link de redefinição' }));
    await screen.findByText('Solicitação enviada');

    const backButtons = screen.getAllByRole('button', { name: 'Voltar ao login' });
    await fireEvent.press(backButtons[backButtons.length - 1]);

    expect(await screen.findByText('Entrar no Baluarte')).toBeOnTheScreen();
    expect(screen.queryByText('Solicitação enviada')).not.toBeOnTheScreen();
    expect(screen.queryByText('Redefinir senha')).not.toBeOnTheScreen();
  });
});
