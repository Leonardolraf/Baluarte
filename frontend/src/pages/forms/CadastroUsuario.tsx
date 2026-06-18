import { useState } from 'react';
import type { FormEvent } from 'react';
import { FormShell, Campo, Botao, Mensagem } from './FormShell';
import { emailValido } from './validacao';

// Tecnica: Tabela de Decisao (R1 nome, R2 e-mail valido, R3 senha >= 8, R4 confirmacao igual).
export function CadastroUsuario() {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);

  function enviar(e: FormEvent) {
    e.preventDefault();
    setOk(false);
    if (!nome) return setMsg('Nome obrigatório');
    if (!emailValido(email)) return setMsg('Email inválido');
    if (senha.length < 8) return setMsg('Senha inválida');
    if (senha !== confirmar) return setMsg('Senhas diferentes');
    setOk(true);
    setMsg('Cadastro realizado com sucesso');
  }

  return (
    <FormShell titulo="Cadastro de Usuário" subtitulo="Crie uma conta de acesso à plataforma.">
      <form onSubmit={enviar} noValidate>
        <Campo id="nome" label="Nome" valor={nome} onChange={setNome} />
        <Campo id="email" label="E-mail" tipo="email" valor={email} onChange={setEmail} />
        <Campo id="senha" label="Senha" tipo="password" valor={senha} onChange={setSenha} />
        <Campo id="confirmarSenha" label="Confirmar senha" tipo="password" valor={confirmar} onChange={setConfirmar} />
        <Botao id="btnCadastrar">Cadastrar</Botao>
        <Mensagem texto={msg} ok={ok} />
      </form>
    </FormShell>
  );
}
