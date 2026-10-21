import { useIsFocused } from '@react-navigation/native';
import { useToastOffset } from '../../contexts';

interface ToastOffsetProps {
  /** Quanto o toast desce além da área segura enquanto esta tela está em foco. */
  offset: number;
}

/**
 * Não desenha nada (por isso não tem styles.ts): enquanto a tela está em foco,
 * informa ao toast onde ele deve aparecer (abaixo do cabeçalho, da saudação…).
 * Fica num componente próprio para que só ele renderize de novo quando o foco muda.
 */
export function ToastOffset({ offset }: ToastOffsetProps) {
  const isFocused = useIsFocused();
  useToastOffset(offset, isFocused);
  return null;
}
