import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';
import { TemplateSelect } from '../../components';
import { nextTemplateSelection, type TemplateSelectMode } from '../../components/TemplateSelect/selection';
import { getTemplate } from '../../data/templates';
import type { TemplateId } from '../../types';

/** Uso real do componente: estado no pai + descrição do modelo selecionado. */
function Harness({ mode }: { mode: TemplateSelectMode }) {
  const [value, setValue] = useState<TemplateId | null>(null);
  return (
    <>
      <TemplateSelect mode={mode} value={value} onChange={setValue} />
      <Text testID="description">{value ? getTemplate(value).description : 'Selecione um modelo.'}</Text>
    </>
  );
}

describe('TemplateSelect — modo rádio (Nova campanha)', () => {
  it('começa sem seleção e com a dica "Selecione um modelo."', async () => {
    await render(<Harness mode="radio" />);

    expect(screen.getAllByRole('radio')).toHaveLength(3);
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(screen.getByTestId('description')).toHaveTextContent('Selecione um modelo.');
  });

  it('tocar seleciona e a descrição acompanha', async () => {
    await render(<Harness mode="radio" />);

    await fireEvent.press(screen.getByRole('radio', { name: 'Autoridade' }));

    expect(screen.getByRole('radio', { name: 'Autoridade' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Urgência' })).not.toBeChecked();
    expect(screen.getByTestId('description')).toHaveTextContent(
      'Solicitação vinda de um "diretor" ou de "TI": "atualize sua senha agora".',
    );

    await fireEvent.press(screen.getByRole('radio', { name: 'Curiosidade' }));
    expect(screen.getByRole('radio', { name: 'Curiosidade' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Autoridade' })).not.toBeChecked();
    expect(screen.getByTestId('description')).toHaveTextContent(
      'Isca de interesse: "veja o novo plano de cargos e salários".',
    );
  });

  it('tocar no já selecionado mantém a seleção (é rádio)', async () => {
    await render(<Harness mode="radio" />);

    await fireEvent.press(screen.getByRole('radio', { name: 'Urgência' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Urgência' }));

    expect(screen.getByRole('radio', { name: 'Urgência' })).toBeChecked();
    expect(screen.getByTestId('description')).toHaveTextContent(
      'Pressão por ação imediata: "sua conta será bloqueada em 24h".',
    );
  });

  it('não chama onChange quando a seleção não muda', async () => {
    const onChange = jest.fn();
    await render(<TemplateSelect mode="radio" value="urgency" onChange={onChange} />);

    await fireEvent.press(screen.getByRole('radio', { name: 'Urgência' }));
    expect(onChange).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('radio', { name: 'Curiosidade' }));
    expect(onChange).toHaveBeenCalledWith('curiosity');
  });
});

describe('TemplateSelect — modo filtro (Home)', () => {
  it('tocar seleciona e tocar de novo limpa', async () => {
    await render(<Harness mode="filter" />);
    const urgency = screen.getByRole('button', { name: 'Urgência' });

    await fireEvent.press(urgency);
    expect(screen.getByRole('button', { name: 'Urgência' })).toBeSelected();

    await fireEvent.press(screen.getByRole('button', { name: 'Urgência' }));
    expect(screen.getByRole('button', { name: 'Urgência' })).not.toBeSelected();
    expect(screen.getByTestId('description')).toHaveTextContent('Selecione um modelo.');
  });
});

describe('nextTemplateSelection', () => {
  it('descreve as duas regras de seleção', () => {
    expect(nextTemplateSelection('radio', null, 'urgency')).toBe('urgency');
    expect(nextTemplateSelection('radio', 'urgency', 'urgency')).toBe('urgency');
    expect(nextTemplateSelection('radio', 'urgency', 'authority')).toBe('authority');
    expect(nextTemplateSelection('filter', null, 'curiosity')).toBe('curiosity');
    expect(nextTemplateSelection('filter', 'curiosity', 'curiosity')).toBeNull();
    expect(nextTemplateSelection('filter', 'curiosity', 'authority')).toBe('authority');
  });
});
