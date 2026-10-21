import type { TemplateId } from '../../types';

/**
 * Como o TemplateSelect se comporta:
 * - `filter` (Home): tocar seleciona; tocar de novo no mesmo card limpa o filtro;
 * - `radio` (Nova campanha): tocar seleciona; tocar no já selecionado MANTÉM a seleção.
 */
export type TemplateSelectMode = 'filter' | 'radio';

export function nextTemplateSelection(
  mode: TemplateSelectMode,
  current: TemplateId | null,
  pressed: TemplateId,
): TemplateId | null {
  if (mode === 'radio') return pressed;
  return current === pressed ? null : pressed;
}
