import { useState } from 'react';
import type { FormEvent } from 'react';
import { FormShell, Campo, Botao, Mensagem } from './FormShell';

// Tecnica: Analise de Valor de Borda (comprimento da nova senha: minimo 8, maximo 64).
export function AlterarSenha() {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);

  function enviar(e: FormEvent) {
    e.preventDefault();
    setOk(false);
    if (nova.length < 8) return setMsg('A nova senha deve ter no mínimo 8 caracteres');
    if (nova.length > 64) return setMsg('A nova senha deve ter no máximo 64 caracteres');
    if (nova !== confirmar) return setMsg('As senhas não conferem');
    setOk(true);
    setMsg('Senha alterada com sucesso');
  }

  return (
    <FormShell titulo="Alterar Senha" subtitulo="Defina uma nova senha (8 a 64 caracteres).">
      <form onSubmit={enviar} noValidate>
        <Campo id="senhaAtual" label="Senha atual" tipo="password" valor={atual} onChange={setAtual} />
        <Campo id="novaSenha" label="Nova senha" tipo="password" valor={nova} onChange={setNova} />
        <Campo id="confirmarSenha" label="Confirmar nova senha" tipo="password" valor={confirmar} onChange={setConfirmar} />
        <Botao id="btnAlterar">Alterar senha</Botao>
        <Mensagem texto={msg} ok={ok} />
      </form>
    </FormShell>
  );
}
