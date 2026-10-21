import { fireEvent, render, screen } from '@testing-library/react-native';
import { GroupPickerModal } from '../../components';
import { TARGET_GROUPS } from '../../data/groups';
import { ADMIN, renderApp } from '../../test-utils';

describe('GroupPickerModal', () => {
  it('lista os 7 grupos, marca o selecionado e devolve a escolha', async () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    await render(
      <GroupPickerModal visible selected="Financeiro" onSelect={onSelect} onClose={onClose} />,
    );

    expect(screen.getByText('Grupo-alvo')).toBeOnTheScreen();
    expect(screen.getAllByRole('radio')).toHaveLength(TARGET_GROUPS.length);
    expect(screen.getByRole('radio', { name: 'Financeiro' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Todos os colaboradores' })).not.toBeChecked();

    await fireEvent.press(screen.getByRole('radio', { name: 'RH' }));
    expect(onSelect).toHaveBeenCalledWith('RH');

    await fireEvent.press(screen.getByRole('button', { name: 'Fechar seleção de grupo-alvo' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('não renderiza nada quando fechado', async () => {
    await render(
      <GroupPickerModal visible={false} selected="TI" onSelect={jest.fn()} onClose={jest.fn()} />,
    );
    expect(screen.queryByText('Grupo-alvo')).not.toBeOnTheScreen();
  });

  it('na Nova campanha, escolher "RH" atualiza a linha do grupo-alvo e fecha o modal', async () => {
    await renderApp({ user: ADMIN });
    await fireEvent.press(screen.getByRole('button', { name: 'Nova campanha' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Grupo-alvo: Financeiro' }));
    expect(screen.getByText('Todos os colaboradores')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('radio', { name: 'RH' }));

    expect(screen.getByRole('button', { name: 'Grupo-alvo: RH' })).toBeOnTheScreen();
    expect(screen.queryByText('Todos os colaboradores')).not.toBeOnTheScreen();
  });
});
