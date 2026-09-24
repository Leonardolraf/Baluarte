import {
  inferScheduleYear,
  MESSAGES,
  parseRecipients,
  resolveSchedule,
  validateCampaignName,
  validateEmail,
  validateNewCampaign,
  validatePassword,
  validateRecipients,
  validateTemplate,
  type NewCampaignForm,
} from '../../lib/validation';

const NOW = new Date(2026, 8, 23, 10, 0); // 23/09/2026 10:00

describe('lib/validation — login', () => {
  it('valida o e-mail com as mensagens do produto', () => {
    expect(validateEmail('')).toBe('E-mail é obrigatório');
    expect(validateEmail('   ')).toBe('E-mail é obrigatório');
    expect(validateEmail('admin')).toBe('Formato de e-mail inválido');
    expect(validateEmail('admin@empresa')).toBe('Formato de e-mail inválido');
    expect(validateEmail(' admin@empresa.com ')).toBeNull();
  });

  it('exige senha com ao menos 6 caracteres', () => {
    expect(validatePassword('')).toBe('Senha é obrigatória');
    expect(validatePassword('12345')).toBe('A senha deve ter ao menos 6 caracteres.');
    expect(validatePassword('123456')).toBeNull();
  });
});

describe('lib/validation — nova campanha', () => {
  it('nome entre 3 e 80 caracteres', () => {
    expect(validateCampaignName('')).toBe(MESSAGES.nameRequired);
    expect(validateCampaignName(' ab ')).toBe('O nome deve ter ao menos 3 caracteres.');
    expect(validateCampaignName('x'.repeat(81))).toBe('O nome deve ter no máximo 80 caracteres.');
    expect(validateCampaignName('Simulação Q4 – Financeiro')).toBeNull();
  });

  it('exige um modelo', () => {
    expect(validateTemplate(null)).toBe('Selecione um modelo.');
    expect(validateTemplate('urgency')).toBeNull();
  });

  it('separa destinatários por linha, vírgula ou ponto e vírgula (sem repetidos)', () => {
    expect(
      parseRecipients('Ana.Almeida@empresa.com\nbruno@empresa.com, carla@empresa.com;\n\nana.almeida@empresa.com'),
    ).toEqual(['ana.almeida@empresa.com', 'bruno@empresa.com', 'carla@empresa.com']);
  });

  it('valida a lista de destinatários', () => {
    expect(validateRecipients(' \n , ').error).toBe('Informe ao menos um destinatário.');
    expect(validateRecipients('ana@empresa.com\nbruno.empresa.com').error).toBe(
      'E-mail inválido: bruno.empresa.com',
    );
    expect(validateRecipients('ana@empresa.com, hacker@gmail.com').error).toBe(
      'Somente destinatários @empresa.com: hacker@gmail.com',
    );
    expect(validateRecipients('a@x.com;b@y.com;c@z.com;d@w.com').error).toBe(
      'Somente destinatários @empresa.com: a@x.com, b@y.com, c@z.com (+1)',
    );

    const ok = validateRecipients('ana.almeida@empresa.com\nbruno.barbosa@empresa.com');
    expect(ok.error).toBeNull();
    expect(ok.emails).toEqual(['ana.almeida@empresa.com', 'bruno.barbosa@empresa.com']);
  });

  it('monta a data do disparo no ano corrente e exige data futura', () => {
    const future = resolveSchedule({ day: '30', month: '09', hour: '09', minute: '00' }, NOW);
    expect(future.error).toBeNull();
    expect(future.date).toEqual(new Date(2026, 8, 30, 9, 0));

    // Mês atual: hoje mais cedo e dias que já passaram continuam recusados.
    expect(resolveSchedule({ day: '23', month: '09', hour: '09', minute: '59' }, NOW).error).toBe(
      'Informe uma data e hora futuras.',
    );
    expect(resolveSchedule({ day: '22', month: '09', hour: '18', minute: '00' }, NOW).error).toBe(
      'Informe uma data e hora futuras.',
    );
    expect(resolveSchedule({ day: '23', month: '09', hour: '10', minute: '01' }, NOW).error).toBeNull();
  });

  it('rejeita campos fora do intervalo e datas que não existem', () => {
    const invalid = 'Informe uma data e hora válidas.';
    expect(resolveSchedule({ day: '', month: '09', hour: '09', minute: '00' }, NOW).error).toBe(invalid);
    expect(resolveSchedule({ day: '32', month: '09', hour: '09', minute: '00' }, NOW).error).toBe(invalid);
    expect(resolveSchedule({ day: '10', month: '13', hour: '09', minute: '00' }, NOW).error).toBe(invalid);
    expect(resolveSchedule({ day: '10', month: '10', hour: '24', minute: '00' }, NOW).error).toBe(invalid);
    expect(resolveSchedule({ day: '10', month: '10', hour: '09', minute: '60' }, NOW).error).toBe(invalid);
    expect(resolveSchedule({ day: '31', month: '11', hour: '09', minute: '00' }, NOW).error).toBe(invalid);
    expect(resolveSchedule({ day: 'aa', month: '10', hour: '09', minute: '00' }, NOW).error).toBe(invalid);
  });

  it('mês anterior ao atual é do ano seguinte (próxima ocorrência da data)', () => {
    // Hoje = 23/09/2026: setembro em diante fica em 2026; janeiro a agosto vão para 2027.
    expect(inferScheduleYear(9, NOW)).toBe(2026);
    expect(inferScheduleYear(12, NOW)).toBe(2026);
    expect(inferScheduleYear(8, NOW)).toBe(2027);
    expect(inferScheduleYear(1, NOW)).toBe(2027);

    const january = resolveSchedule({ day: '15', month: '01', hour: '09', minute: '00' }, NOW);
    expect(january.error).toBeNull();
    expect(january.date).toEqual(new Date(2027, 0, 15, 9, 0));

    // Virada do ano: em 20/12, "02/02" é fevereiro do ano seguinte.
    const december = new Date(2026, 11, 20, 10, 0);
    expect(inferScheduleYear(12, december)).toBe(2026);
    const february = resolveSchedule({ day: '02', month: '02', hour: '09', minute: '00' }, december);
    expect(february.error).toBeNull();
    expect(february.date).toEqual(new Date(2027, 1, 2, 9, 0));

    // O ano seguinte também vale para a checagem de data existente: 29/02/2027 não existe.
    expect(resolveSchedule({ day: '29', month: '02', hour: '09', minute: '00' }, NOW).error).toBe(
      'Informe uma data e hora válidas.',
    );
  });

  it('valida o formulário inteiro e devolve os dados prontos', () => {
    const form: NewCampaignForm = {
      name: '  Simulação Q4 – Financeiro ',
      template: 'urgency',
      targetGroup: 'Financeiro',
      schedule: { day: '30', month: '09', hour: '09', minute: '00' },
      recipients: 'ana.almeida@empresa.com\nbruno.barbosa@empresa.com',
    };

    const result = validateNewCampaign(form, NOW);
    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Simulação Q4 – Financeiro',
        template: 'urgency',
        targetGroup: 'Financeiro',
        scheduledAt: new Date(2026, 8, 30, 9, 0),
        recipients: ['ana.almeida@empresa.com', 'bruno.barbosa@empresa.com'],
      },
    });
  });

  it('acumula os erros de todos os campos', () => {
    const result = validateNewCampaign(
      {
        name: 'ab',
        template: null,
        targetGroup: '',
        schedule: { day: '01', month: '09', hour: '09', minute: '00' },
        recipients: 'x@gmail.com',
      },
      NOW,
    );

    expect(result).toEqual({
      ok: false,
      errors: {
        name: 'O nome deve ter ao menos 3 caracteres.',
        template: 'Selecione um modelo.',
        targetGroup: 'Selecione o grupo-alvo.',
        schedule: 'Informe uma data e hora futuras.',
        recipients: 'Somente destinatários @empresa.com: x@gmail.com',
      },
    });
  });
});
