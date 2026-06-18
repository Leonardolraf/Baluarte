import { useState } from 'react';
import type { FormEvent } from 'react';
import { FormShell, Campo, Botao, Mensagem } from './FormShell';

// Tecnica: Tabela de Decisao (R1 token valido, R2 senha >= 8, R3 confirmacao igual).
const TOKEN_VALIDO = 'TOKEN-VALIDO-123';

export function ResetSenha() {
  const [token, setToken] = useState('');
  const [nova, setNova] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);

  function enviar(e: FormEvent) {
    e.preventDefault();
    setOk(false);
    if (token.trim() !== TOKEN_VALIDO) return setMsg('Token inválido ou expirado');
    if (nova.length < 8) return setMsg('A senha deve ter no mínimo 8 caracteres');
    if (nova !== confirmar) return setMsg('As senhas não conferem');
    setOk(true);
    setMsg('Senha redefinida com sucesso');
  }

  return (
    <FormShell titulo="Redefinir Senha" subtitulo="Use o token recebido por e-mail para criar uma nova senha.">
      <form onSubmit={enviar} noValidate>
        <Campo id="token" label="Token de redefinição" valor={token} onChange={setToken} />
        <Campo id="novaSenha" label="Nova senha" tipo="password" valor={nova} onChange={setNova} />
        <Campo id="confirmarSenha" label="Confirmar nova senha" tipo="password" valor={confirmar} onChange={setConfirmar} />
        <Botao id="btnRedefinir">Redefinir senha</Botao>
        <Mensagem texto={msg} ok={ok} />
      </form>
    </FormShell>
  );
}
