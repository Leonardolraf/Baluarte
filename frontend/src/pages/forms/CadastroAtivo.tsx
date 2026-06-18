import { useState } from 'react';
import type { FormEvent } from 'react';
import { FormShell, Campo, SelectCampo, Botao, Mensagem } from './FormShell';
import { hostValido, HOSTS_EXISTENTES } from './validacao';

// Tecnica: Particao de Equivalencia (nome, tipo e host em classes validas/invalidas).
const TIPOS = [
  { valor: 'Servidor', texto: 'Servidor' },
  { valor: 'Aplicacao', texto: 'Aplicação' },
  { valor: 'Rede', texto: 'Rede' },
  { valor: 'Banco de Dados', texto: 'Banco de Dados' },
];

export function CadastroAtivo() {
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState('');
  const [host, setHost] = useState('');
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);

  function enviar(e: FormEvent) {
    e.preventDefault();
    setOk(false);
    if (!nome) return setMsg('Nome do ativo é obrigatório');
    if (!tipo) return setMsg('Tipo é obrigatório');
    if (!hostValido(host)) return setMsg('Host inválido');
    if (HOSTS_EXISTENTES.includes(host.trim())) return setMsg('Ativo já cadastrado');
    setOk(true);
    setMsg('Ativo cadastrado com sucesso');
  }

  return (
    <FormShell titulo="Cadastro de Ativo" subtitulo="Registre um host/aplicação para varredura.">
      <form onSubmit={enviar} noValidate>
        <Campo id="nome" label="Nome do ativo" valor={nome} onChange={setNome} />
        <SelectCampo id="tipo" label="Tipo" valor={tipo} onChange={setTipo} opcoes={TIPOS} />
        <Campo id="host" label="Host (IP ou domínio)" valor={host} onChange={setHost} />
        <Botao id="btnCadastrar">Cadastrar ativo</Botao>
        <Mensagem texto={msg} ok={ok} />
      </form>
    </FormShell>
  );
}
