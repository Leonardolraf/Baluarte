import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser, RBACRole } from '@/types';
import { AuthProvider } from '@/contexts/AuthContext';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
import { MAX_FILE_SIZE_BYTES } from '@/lib/files';
import { mockApi, setMockAntivirusAvailable, setMockSecondOpinion } from '@/mocks/api';
import { MOCK_USERS } from '@/mocks/data';
import FileAnalysisPage from '@/pages/Files/FileAnalysisPage';

function renderAs(role: RBACRole) {
  const found = MOCK_USERS.find((u) => u.role === role && u.status !== 'inactive')!;
  const user: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
  const token = buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
  tokenStorage.set(token);
  userStorage.set(user);
  return render(
    <MemoryRouter initialEntries={['/files']}>
      <AuthProvider initialSession={{ status: 'authenticated', token, user }} revalidateOnMount={false}>
        <FileAnalysisPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function fileInput(): HTMLInputElement {
  return screen.getByTestId('file-input') as HTMLInputElement;
}

function choose(file: File) {
  fireEvent.change(fileInput(), { target: { files: [file] } });
}

async function historyTable(): Promise<HTMLElement> {
  const card = (await screen.findByText('Análises anteriores')).closest('section')!;
  return within(card).getByRole('table');
}

describe('FileAnalysisPage (B05)', () => {
  it('envio sem ameaça: veredito cuidadoso, nome, tamanho, SHA-256 copiável e anúncio', async () => {
    const user = userEvent.setup();
    renderAs('collaborator');
    await historyTable();

    choose(new File(['relatório trimestral'], 'relatorio.txt', { type: 'text/plain' }));

    const verdict = await screen.findByTestId('file-verdict');
    expect(verdict).toHaveAttribute('data-result', 'clean');
    expect(verdict).toHaveTextContent('Nenhuma ameaça conhecida encontrada');
    // Nunca promete segurança nem diz só "limpo".
    expect(screen.queryByText(/arquivo seguro/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^limpo$/i)).not.toBeInTheDocument();

    const result = screen.getByRole('heading', { name: 'Resultado da análise' }).closest('section')!;
    expect(within(result).getAllByText('relatorio.txt').length).toBeGreaterThan(0);
    expect(within(result).getByText(/bytes\)/)).toBeInTheDocument();
    const hash = within(result).getByText(/^[0-9a-f]{64}$/);

    await user.click(within(result).getByRole('button', { name: 'Copiar SHA-256' }));
    await expect(navigator.clipboard.readText()).resolves.toBe(hash.textContent);

    expect(screen.getByTestId('file-scan-announcer')).toHaveTextContent(
      'Nenhuma ameaça conhecida encontrada. Arquivo relatorio.txt.',
    );
    // A análise nova entra no topo do histórico.
    const table = await historyTable();
    await waitFor(() => expect(within(table).getAllByRole('row')[1]).toHaveTextContent('relatorio.txt'));
  });

  it('envio com ameaça: destaque com o nome da assinatura', async () => {
    renderAs('collaborator');
    await historyTable();

    choose(new File(['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'], 'eicar.com'));

    const verdict = await screen.findByTestId('file-verdict');
    expect(verdict).toHaveAttribute('data-result', 'threat');
    expect(verdict).toHaveTextContent('Ameaça encontrada');
    expect(within(verdict).getByText('Eicar-Signature')).toBeInTheDocument();
    expect(screen.getByTestId('file-scan-announcer')).toHaveTextContent(
      'Ameaça encontrada: Eicar-Signature. Arquivo eicar.com.',
    );
    expect(within(await historyTable()).getByText('Ameaça: Eicar-Signature')).toBeInTheDocument();
  });

  it('arquivo acima de 10 MB é barrado antes de enviar', async () => {
    const spy = vi.spyOn(mockApi, 'analyzeFile');
    renderAs('analyst');
    await historyTable();

    const big = new File(['x'], 'backup.iso');
    Object.defineProperty(big, 'size', { value: MAX_FILE_SIZE_BYTES + 1 });
    choose(big);

    expect(await screen.findByTestId('form-error')).toHaveTextContent('O arquivo passa do limite de 10 MB');
    expect(screen.getByTestId('form-error')).toHaveTextContent('backup.iso');
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('file-verdict')).not.toBeInTheDocument();
  });

  it('503: avisa que a análise não está disponível neste ambiente', async () => {
    setMockAntivirusAvailable(false);
    renderAs('collaborator');
    await historyTable();

    choose(new File(['abc'], 'contrato.pdf'));

    expect(await screen.findByTestId('form-error')).toHaveTextContent(
      'A análise de arquivos não está disponível neste ambiente',
    );
    expect(screen.queryByTestId('file-verdict')).not.toBeInTheDocument();
  });

  it('histórico do colaborador: só as próprias análises, sem a coluna de quem enviou', async () => {
    renderAs('collaborator');
    const table = await historyTable();

    expect(within(table).queryByRole('columnheader', { name: 'Enviado por' })).not.toBeInTheDocument();
    expect(within(table).getByText('proposta-comercial-v3.pdf')).toBeInTheDocument();
    // eicar.com do seed é do analista: não aparece para o colaborador.
    expect(within(table).queryByText('eicar.com')).not.toBeInTheDocument();
    expect(screen.getByText('Suas análises, mais recentes primeiro')).toBeInTheDocument();
  });

  it('histórico de operador: todas as análises, com nome e e-mail de quem enviou', async () => {
    renderAs('admin');
    const table = await historyTable();

    expect(within(table).getByRole('columnheader', { name: 'Enviado por' })).toBeInTheDocument();
    const eicarRow = within(table).getByText('eicar.com').closest('tr')!;
    expect(within(eicarRow).getByText('Rafael Nunes')).toBeInTheDocument();
    expect(within(eicarRow).getByText('analista@empresa.com')).toBeInTheDocument();
    expect(within(table).getByText('proposta-comercial-v3.pdf')).toBeInTheDocument();
  });

  it('zona de soltar funciona por teclado (Enter e Espaço abrem a escolha do arquivo)', async () => {
    const user = userEvent.setup();
    renderAs('collaborator');
    await historyTable();
    const click = vi.spyOn(fileInput(), 'click');

    const zone = screen.getByRole('button', { name: /Escolher arquivo para análise/ });
    expect(zone).toHaveAccessibleDescription(/até 10 MB/);
    await user.tab();
    while (document.activeElement !== zone) await user.tab();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('aceita arquivo arrastado e solto na zona', async () => {
    renderAs('collaborator');
    await historyTable();
    const zone = screen.getByTestId('file-dropzone');

    fireEvent.dragOver(zone, { dataTransfer: { files: [] } });
    expect(zone).toHaveAttribute('data-dragging', 'true');
    expect(zone).toHaveTextContent('Solte para analisar');
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['ok'], 'planilha.csv')] } });

    expect(await screen.findByTestId('file-verdict')).toHaveAttribute('data-result', 'clean');
    expect(zone).not.toHaveAttribute('data-dragging');
  });

  it('mostra a barra de envio enquanto o arquivo sobe e o antivírus analisa', async () => {
    let finish: () => void = () => undefined;
    vi.spyOn(mockApi, 'analyzeFile').mockImplementation(async (file, options) => {
      options?.onProgress?.(40);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      options?.onProgress?.(100);
      return {
        scan: {
          id: 'arq-x',
          name: file.name,
          size: file.size,
          sha256: 'a'.repeat(64),
          result: 'clean',
          threat: null,
          scannedAt: new Date().toISOString(),
          secondOpinion: null,
        },
        message: 'Nenhuma ameaça conhecida encontrada',
      };
    });
    renderAs('collaborator');
    await historyTable();

    choose(new File(['abc'], 'lento.bin'));
    const bar = await screen.findByRole('progressbar', { name: 'Envio do arquivo' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByTestId('file-scan-announcer')).toHaveTextContent('Enviando lento.bin');
    expect(screen.getByTestId('file-dropzone')).toHaveAttribute('aria-disabled', 'true');

    finish();
    expect(await screen.findByTestId('file-verdict')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  describe('segunda opinião do VirusTotal (B20)', () => {
    it('EICAR: detecções/total abaixo do veredito, com link para o relatório do hash', async () => {
      renderAs('collaborator');
      await historyTable();

      choose(
        new File(['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'], 'eicar.com'),
      );

      const panel = await screen.findByTestId('second-opinion');
      expect(panel).toHaveAttribute('data-status', 'malicious');
      expect(panel).toHaveTextContent('61 de 68 antivírus do VirusTotal detectaram este arquivo');
      expect(panel).toHaveTextContent(/Consultado em/);
      const hash = within(
        screen.getByRole('heading', { name: 'Resultado da análise' }).closest('section')!,
      ).getByText(/^[0-9a-f]{64}$/).textContent;
      const link = within(panel).getByRole('link', { name: /Ver relatório do hash no VirusTotal/ });
      expect(link).toHaveAttribute('href', `https://www.virustotal.com/gui/file/${hash}`);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
      // O veredito principal continua sendo o do antivírus.
      const verdict = screen.getByTestId('file-verdict');
      expect(verdict.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByTestId('file-scan-announcer')).toHaveTextContent('VirusTotal: 61 de 68');
    });

    it('arquivo que o VirusTotal não conhece: texto claro de que só o hash foi consultado', async () => {
      renderAs('collaborator');
      await historyTable();

      choose(new File(['conteúdo novo nunca visto'], 'novo.docx'));

      const panel = await screen.findByTestId('second-opinion');
      expect(panel).toHaveAttribute('data-status', 'unknown');
      expect(panel).toHaveTextContent('O VirusTotal não conhece este arquivo');
      expect(panel).toHaveTextContent('O arquivo não foi enviado ao VirusTotal');
      expect(screen.getByTestId('file-verdict')).toHaveAttribute('data-result', 'clean');
      expect(screen.queryByText(/arquivo seguro/i)).not.toBeInTheDocument();
    });

    it('cota estourada: "indisponível agora (cota)" e a análise do antivírus segue normal', async () => {
      setMockSecondOpinion('quota');
      renderAs('collaborator');
      await historyTable();

      choose(new File(['sem cota'], 'planilha.xlsx'));

      const panel = await screen.findByTestId('second-opinion');
      expect(panel).toHaveAttribute('data-status', 'unavailable');
      expect(panel).toHaveTextContent('Segunda opinião indisponível agora (cota)');
      expect(panel).toHaveTextContent('O veredito do antivírus acima vale normalmente');
      expect(panel).not.toHaveTextContent(/Consultado em/);
      expect(screen.getByTestId('file-verdict')).toHaveTextContent('Nenhuma ameaça conhecida encontrada');
    });

    it('desligada (sem chave): avisa, sem link', async () => {
      setMockSecondOpinion('disabled');
      renderAs('collaborator');
      await historyTable();

      choose(new File(['abc'], 'a.txt'));

      const panel = await screen.findByTestId('second-opinion');
      expect(panel).toHaveAttribute('data-status', 'disabled');
      expect(panel).toHaveTextContent('Segunda opinião desligada neste ambiente');
      expect(within(panel).queryByRole('link')).not.toBeInTheDocument();
    });

    it('histórico mostra a segunda opinião guardada e "—" nas análises anteriores a ela', async () => {
      renderAs('admin');
      const table = await historyTable();

      expect(within(table).getByRole('columnheader', { name: 'VirusTotal' })).toBeInTheDocument();
      const row = (name: string) => within(table).getByText(name).closest('tr')!;
      expect(within(row('eicar.com')).getByText('61/68 detecções')).toBeInTheDocument();
      expect(within(row('proposta-comercial-v3.pdf')).getByText('0/66 detecções')).toBeInTheDocument();
      expect(within(row('orcamento-2027.xlsx')).getByText('Desconhecido')).toBeInTheDocument();
      expect(
        within(row('nota-fiscal-setembro.zip')).getByTitle('Análise anterior à segunda opinião'),
      ).toBeInTheDocument();
    });
  });
});
