import { notify } from '@/store/uiStore';

/** Copia um texto (hash, vetor CVSS…) e avisa por toast se deu certo ou não. */
export function copyToClipboard(text: string, successMessage: string): void {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    notify.error('A área de transferência não está disponível neste navegador.');
    return;
  }
  navigator.clipboard
    .writeText(text)
    .then(() => notify.success(successMessage))
    .catch(() => notify.error('Não foi possível copiar para a área de transferência.'));
}
