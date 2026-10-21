import { View } from 'react-native';
import { EMAIL_TEMPLATES } from '../../data/templates';
import type { EmailTemplate, TemplateId } from '../../types';
import { TemplateCard } from '../TemplateCard';
import { nextTemplateSelection, type TemplateSelectMode } from './selection';
import { styles } from './styles';

export type { TemplateSelectMode };

interface TemplateSelectProps {
  /** `filter` na Home, `radio` na Nova campanha. */
  mode: TemplateSelectMode;
  value: TemplateId | null;
  onChange: (value: TemplateId | null) => void;
  templates?: readonly EmailTemplate[];
  invalid?: boolean;
}

/**
 * Componente controlado: quem usa guarda o modelo selecionado no próprio estado
 * (Home: filtro da lista; Nova campanha: campo do formulário).
 */
export function TemplateSelect({
  mode,
  value,
  onChange,
  templates = EMAIL_TEMPLATES,
  invalid = false,
}: TemplateSelectProps) {
  function handlePress(pressed: TemplateId) {
    const next = nextTemplateSelection(mode, value, pressed);
    if (next !== value) onChange(next);
  }

  return (
    <View
      style={styles.container}
      accessibilityRole={mode === 'radio' ? 'radiogroup' : undefined}
      accessibilityLabel={mode === 'radio' ? 'Modelo de e-mail' : 'Filtrar campanhas por modelo'}
    >
      {templates.map((template) => (
        <TemplateCard
          key={template.id}
          template={template}
          mode={mode}
          selected={template.id === value}
          invalid={invalid && value === null}
          onPress={() => handlePress(template.id)}
        />
      ))}
    </View>
  );
}
