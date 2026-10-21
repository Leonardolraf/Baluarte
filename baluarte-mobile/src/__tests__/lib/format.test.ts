import {
  clickRate,
  emailFromName,
  EMPTY_VALUE,
  firstName,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatShortDateTime,
  initials,
  nameFromEmail,
  padTwo,
  slugify,
} from '../../lib/format';

describe('lib/format', () => {
  const date = new Date(2026, 9, 18, 9, 0); // 18/10/2026 09:00 (fuso local)

  it('formata a data curta da lista ("DD/MM às HH:MMh")', () => {
    expect(formatShortDateTime(date)).toBe('18/10 às 09:00h');
    expect(formatShortDateTime(new Date(2026, 0, 5, 7, 5))).toBe('05/01 às 07:05h');
  });

  it('formata a data completa do banner ("DD/MM/AAAA HH:MM")', () => {
    expect(formatDateTime(date)).toBe('18/10/2026 09:00');
    expect(formatDateTime(date.toISOString())).toBe('18/10/2026 09:00');
  });

  it('completa com zero à esquerda', () => {
    expect(padTwo(7)).toBe('07');
    expect(padTwo('12')).toBe('12');
  });

  it('formata números com ponto de milhar', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(156)).toBe('156');
    expect(formatNumber(1234)).toBe('1.234');
    expect(formatNumber(1234567)).toBe('1.234.567');
  });

  it('calcula a taxa de clique arredondada (clicaram / enviados)', () => {
    expect(clickRate(37, 156)).toBe(24);
    expect(clickRate(34, 120)).toBe(28);
    expect(clickRate(63, 203)).toBe(31);
    expect(clickRate(31, 180)).toBe(17);
    expect(clickRate(0, 0)).toBeNull();
  });

  it('formata percentual e usa "—" quando não há valor', () => {
    expect(formatPercent(24)).toBe('24%');
    expect(formatPercent(null)).toBe(EMPTY_VALUE);
    expect(EMPTY_VALUE).toBe('—');
  });

  it('gera iniciais do primeiro e do último nome', () => {
    expect(initials('Ana Almeida')).toBe('AA');
    expect(initials('Leonardo Rodrigues')).toBe('LR');
    expect(initials('  otávio   de oliveira ')).toBe('OO');
    expect(initials('Madonna')).toBe('M');
    expect(initials('')).toBe('?');
  });

  it('extrai o primeiro nome', () => {
    expect(firstName('Leonardo Rodrigues')).toBe('Leonardo');
    expect(firstName('Rafael')).toBe('Rafael');
  });

  it('deriva o nome a partir do e-mail', () => {
    expect(nameFromEmail('ana.almeida@empresa.com')).toBe('Ana Almeida');
    expect(nameFromEmail('bruno_barbosa@empresa.com')).toBe('Bruno Barbosa');
    expect(nameFromEmail('carla-maria.cardoso@empresa.com')).toBe('Carla Maria Cardoso');
  });

  it('remove acentos e monta o e-mail a partir do nome', () => {
    expect(slugify('Patrícia Gonçalves')).toBe('patricia goncalves');
    expect(emailFromName('Otávio Oliveira')).toBe('otavio.oliveira@empresa.com');
    expect(emailFromName('João Nunes')).toBe('joao.nunes@empresa.com');
  });
});
