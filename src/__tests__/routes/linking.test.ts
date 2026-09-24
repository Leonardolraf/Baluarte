import { webLinking } from '../../routes/linking';

/** Pilha montada a partir de uma URL (nome de cada rota, de baixo para cima). */
function stackFor(path: string) {
  return webLinking.getStateFromPath?.(path, webLinking.config)?.routes.map((route) => route.name);
}

function focusedRoute(path: string) {
  const routes = webLinking.getStateFromPath?.(path, webLinking.config)?.routes;
  return routes?.[routes.length - 1];
}

describe('URLs na web (routes/linking.ts)', () => {
  it('cada tela tem um caminho em português', () => {
    expect(focusedRoute('/')).toMatchObject({ name: 'Login' });
    expect(focusedRoute('/redefinir-senha')).toMatchObject({ name: 'ResetPassword' });
    expect(focusedRoute('/redefinir-senha/enviada')).toMatchObject({ name: 'ResetSent' });
    expect(focusedRoute('/campanhas')).toMatchObject({ name: 'Home' });
    expect(focusedRoute('/campanhas/nova')).toMatchObject({ name: 'NewCampaign' });
    expect(focusedRoute('/campanhas/camp-001')).toMatchObject({
      name: 'CampaignDetails',
      params: { campaignId: 'camp-001' },
    });
    expect(focusedRoute('/treinamentos/trn-urgency')).toMatchObject({
      name: 'Training',
      params: { trainingId: 'trn-urgency' },
    });
  });

  it('tela aberta direto pela URL (ou página recarregada) ganha a tela de base embaixo', () => {
    expect(stackFor('/')).toEqual(['Login']);
    expect(stackFor('/campanhas')).toEqual(['Home']);
    expect(stackFor('/campanhas/camp-001')).toEqual(['Home', 'CampaignDetails']);
    expect(stackFor('/campanhas/nova')).toEqual(['Home', 'NewCampaign']);
    expect(stackFor('/treinamentos/trn-urgency')).toEqual(['Home', 'Training']);
    expect(stackFor('/redefinir-senha')).toEqual(['Login', 'ResetPassword']);
    expect(stackFor('/redefinir-senha/enviada')).toEqual(['Login', 'ResetSent']);
  });

  it('o e-mail levado do Login para a redefinição não vai para a URL', () => {
    const path = webLinking.getPathFromState?.(
      {
        index: 1,
        routes: [{ name: 'Login' }, { name: 'ResetPassword', params: { email: 'admin@empresa.com' } }],
      },
      webLinking.config,
    );
    expect(path).toBe('/redefinir-senha');
  });
});
