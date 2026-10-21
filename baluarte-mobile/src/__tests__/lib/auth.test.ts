import { AUTH_MESSAGES, authenticate, canAccessCampaigns } from '../../lib/auth';

describe('lib/auth — autenticação simulada', () => {
  it('recusa e-mail que não é de uma conta demo', () => {
    expect(authenticate('fulano@empresa.com', 'senha-forte')).toEqual({
      ok: false,
      error: AUTH_MESSAGES.invalidCredentials,
    });
  });

  it('recusa senha curta com a mesma mensagem genérica', () => {
    expect(authenticate('admin@empresa.com', '12345')).toEqual({
      ok: false,
      error: 'E-mail ou senha inválidos.',
    });
  });

  it('aceita administrador e analista com qualquer senha de 6+ caracteres', () => {
    const admin = authenticate(' Admin@Empresa.com ', 'abcdef');
    expect(admin.ok && admin.user.name).toBe('Leonardo Rodrigues');

    const analyst = authenticate('analista@empresa.com', 'outra-senha');
    expect(analyst.ok && analyst.user.role).toBe('analyst');
  });

  it('bloqueia o Colaborador (RBAC: campanhas só para Administrador e Analista)', () => {
    expect(authenticate('colaborador@empresa.com', 'senha-forte')).toEqual({
      ok: false,
      error: 'O perfil Colaborador não tem acesso às campanhas neste app.',
    });
    expect(canAccessCampaigns('admin')).toBe(true);
    expect(canAccessCampaigns('analyst')).toBe(true);
    expect(canAccessCampaigns('collaborator')).toBe(false);
  });
});
