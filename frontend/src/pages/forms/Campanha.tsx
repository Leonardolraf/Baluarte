import { useState } from 'react';
import type { FormEvent } from 'react';
import { FormShell, Campo, SelectCampo, Botao, Mensagem } from './FormShell';
import { emailValido, DOMINIO_INTERNO } from './validacao';

// Tecnica: Particao de Equivalencia (destinatario interno/externo/invalido, template, nome).
const TEMPLATES = [
  { valor: 'urgencia', texto: 'Urgência' },
  { valor: 'autoridade', texto: 'Autoridade' },
  { valor: 'curiosidade', texto: 'Curiosidade' },
];

export function Campanha() {
  const [nome, setNome] = useState('');
  const [destinatario, setDestinatario] = useState('');
  const [template, setTemplate] = useState('');
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);

  function enviar(e: FormEvent) {
    e.preventDefault();
    setOk(false);
    if (!nome) return setMsg('Nome da campanha é obrigatório');
    if (!emailValido(destinatario)) return setMsg('Formato de e-mail inválido');
    if (!destinatario.trim().toLowerCase().endsWith(DOMINIO_INTERNO)) return setMsg('Destinatário não autorizado: apenas e-mails internos');
    if (!template) return setMsg('Template é obrigatório');
    setOk(true);
    setMsg('Campanha criada com sucesso');
  }

  return (
    <FormShell titulo="Nova Campanha de Phishing" subtitulo="Dispare uma simulação controlada para um colaborador interno.">
      <form onSubmit={enviar} noValidate>
        <Campo id="nomeCampanha" label="Nome da campanha" valor={nome} onChange={setNome} />
        <Campo id="destinatario" label="Destinatário (e-mail interno)" tipo="email" valor={destinatario} onChange={setDestinatario} />
        <SelectCampo id="template" label="Template" valor={template} onChange={setTemplate} opcoes={TEMPLATES} />
        <Botao id="btnCriar">Criar campanha</Botao>
        <Mensagem texto={msg} ok={ok} />
      </form>
    </FormShell>
  );
}
