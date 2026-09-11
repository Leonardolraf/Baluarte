import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Severity } from '@/types';
import { SEVERITIES } from '@/types';
import { SEVERITY_BADGE_CLASS, SEVERITY_DOT_CLASS, SEVERITY_LABEL } from '@/lib/severity';
import { SeverityBadge } from '@/components';

/**
 * Contrato visual do badge: rótulo em pt-BR e a classe de cor de texto esperada
 * para cada severidade (vermelho, laranja, amarelo, verde, azul).
 */
const EXPECTED: Record<Severity, { label: string; textClass: string }> = {
  critical: { label: 'Crítico', textClass: 'text-red-700' },
  high: { label: 'Alto', textClass: 'text-orange-700' },
  medium: { label: 'Médio', textClass: 'text-yellow-800' },
  low: { label: 'Baixo', textClass: 'text-green-700' },
  info: { label: 'Informativo', textClass: 'text-blue-700' },
};

describe('SeverityBadge', () => {
  it.each(SEVERITIES)('renderiza "%s" com rótulo pt-BR, data-severity e classe de cor', (severity) => {
    render(<SeverityBadge severity={severity} />);

    const badge = screen.getByTestId('severity-badge');
    expect(badge).toHaveTextContent(EXPECTED[severity].label);
    expect(badge).toHaveTextContent(SEVERITY_LABEL[severity]);
    expect(badge).toHaveAttribute('data-severity', severity);
    expect(badge).toHaveClass(EXPECTED[severity].textClass);
    expect(badge).toHaveClass(...SEVERITY_BADGE_CLASS[severity].split(' '));
  });

  it('usa uma cor distinta para cada severidade', () => {
    const textClasses = SEVERITIES.map((severity) => EXPECTED[severity].textClass);
    expect(new Set(textClasses).size).toBe(SEVERITIES.length);
  });

  it('aceita rótulo alternativo mantendo a severidade como tom', () => {
    render(<SeverityBadge severity="high" label="Administrador" />);

    const badge = screen.getByTestId('severity-badge');
    expect(badge).toHaveTextContent('Administrador');
    expect(badge).not.toHaveTextContent(SEVERITY_LABEL.high);
    expect(badge).toHaveAttribute('data-severity', 'high');
    expect(badge).toHaveClass(EXPECTED.high.textClass);
    expect(badge).not.toHaveAttribute('title');
  });

  it('exibe o ponto colorido decorativo quando `dot` está ativo', () => {
    render(<SeverityBadge severity="critical" dot />);

    const badge = screen.getByTestId('severity-badge');
    const dot = badge.querySelector(`.${SEVERITY_DOT_CLASS.critical}`);
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(badge.querySelector('svg')).toBeNull();
  });

  it('exibe o ícone (e não o ponto) quando `icon` está ativo', () => {
    render(<SeverityBadge severity="low" icon dot />);

    const badge = screen.getByTestId('severity-badge');
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(badge.querySelector(`.${SEVERITY_DOT_CLASS.low}`)).toBeNull();
  });

  it('aplica o tamanho solicitado', () => {
    const { rerender } = render(<SeverityBadge severity="medium" />);
    expect(screen.getByTestId('severity-badge')).toHaveClass('text-xs');

    rerender(<SeverityBadge severity="medium" size="md" />);
    expect(screen.getByTestId('severity-badge')).toHaveClass('text-sm');
  });
});
