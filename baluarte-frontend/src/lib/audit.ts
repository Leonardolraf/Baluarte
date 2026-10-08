// Rótulos das ações da trilha de auditoria (RN-008). O servidor grava códigos
// (`CRIAR_ATIVO`); a tela mostra o rótulo conhecido e, para uma ação que ainda não está
// aqui (ex.: uma funcionalidade nova no backend), deriva um rótulo legível do próprio
// código — a tela e o filtro aceitam ações novas sem mudança de código.

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  LOGIN: 'Login',
  LOGIN_BLOQUEADO: 'Login bloqueado',
  LOGOUT: 'Logout',
  ALTERAR_SENHA: 'Alteração de senha',
  SOLICITAR_RESET_SENHA: 'Pedido de redefinição de senha',
  REDEFINIR_SENHA: 'Redefinição de senha',
  ACEITAR_CONVITE: 'Convite aceito',
  ENVIAR_CONVITE: 'Convite enviado',
  ENVIAR_RESET_SENHA: 'Redefinição de senha enviada',
  CRIAR_USUARIO: 'Usuário criado',
  ATUALIZAR_USUARIO: 'Usuário alterado',
  EXCLUIR_USUARIO: 'Usuário excluído',
  CRIAR_DEPARTAMENTO: 'Departamento criado',
  EXCLUIR_DEPARTAMENTO: 'Departamento excluído',
  CRIAR_ATIVO: 'Ativo cadastrado',
  INICIAR_VARREDURA: 'Varredura iniciada',
  ALTERAR_STATUS_VULNERABILIDADE: 'Status de vulnerabilidade alterado',
  CRIAR_CAMPANHA: 'Campanha criada',
  ENVIAR_CAMPANHA: 'Campanha enviada',
  EXCLUIR_CAMPANHA: 'Campanha excluída',
  CONCLUIR_TREINAMENTO: 'Treinamento concluído',
  CLIQUE_LINK_PHISHING: 'Clique no link de phishing',
  REPORTAR_PHISHING: 'Phishing reportado',
  ANALISAR_ARQUIVO: 'Arquivo analisado',
  INSCREVER_ESTACAO: 'Estação inscrita',
};

/** Rótulo da ação; código desconhecido vira "Coletar inventario" a partir de `COLETAR_INVENTARIO`. */
export function auditActionLabel(action: string): string {
  const known = AUDIT_ACTION_LABEL[action];
  if (known) return known;
  const words = action.trim().toLowerCase().replace(/_+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : action;
}
