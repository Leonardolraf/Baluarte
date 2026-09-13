import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import type { AssetInput, AssetType } from '@/types';
import { ASSET_TYPES } from '@/types';
import { api } from '@/services/api';
import {
  Button,
  Card,
  FormField,
  Icons,
  Input,
  PageHeader,
  Select,
  Textarea,
  describedBy,
} from '@/components';
import { ASSET_TYPE_LABEL, SEVERITY_BADGE_CLASS } from '@/lib/severity';
import { errorMessage, isHttpError } from '@/lib/errors';
import { notify } from '@/store/uiStore';
import { cn } from '@/lib/cn';

interface AssetFormValues {
  name: string;
  type: AssetType | '';
  host: string;
  ip: string;
  description: string;
}

type AssetField = keyof AssetFormValues;

/** Códigos de erro da API que apontam para um campo específico do formulário. */
const FIELD_BY_ERROR_CODE = new Map<string, AssetField>([
  ['HOST_INVALIDO', 'host'],
  ['ATIVO_DUPLICADO', 'host'],
  ['IP_INVALIDO', 'ip'],
  ['NOME_OBRIGATORIO', 'name'],
  ['TIPO_INVALIDO', 'type'],
]);

/** Mesma regra do backend: rótulos alfanuméricos (hífen apenas interno) unidos por ponto, ao menos dois rótulos. */
const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const HOST_HINT = 'Nome DNS (ex.: srv-web-01.empresa.com) ou IPv4.';
const IP_HINT = 'Opcional. IPv4 (ex.: 192.168.0.10).';
const DESCRIPTION_HINT = 'Opcional. Até 500 caracteres.';

function isValidIpv4(value: string): boolean {
  const match = IPV4_RE.exec(value);
  if (!match) return false;
  return match.slice(1).every((octet) => Number(octet) <= 255);
}

function isValidHost(value: string): boolean {
  return isValidIpv4(value) || HOSTNAME_RE.test(value);
}

function isAssetType(value: string): value is AssetType {
  return (ASSET_TYPES as readonly string[]).includes(value);
}

export default function AssetFormPage() {
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AssetFormValues>({
    mode: 'onBlur',
    defaultValues: { name: '', type: '', host: '', ip: '', description: '' },
  });

  async function onSubmit(values: AssetFormValues): Promise<void> {
    setSubmitError(null);
    if (!isAssetType(values.type)) return;

    const input: AssetInput = {
      name: values.name.trim(),
      type: values.type,
      host: values.host.trim(),
    };
    const ip = values.ip.trim();
    if (ip) input.ip = ip;
    const description = values.description.trim();
    if (description) input.description = description;

    try {
      await api.createAsset(input);
      notify.success('Ativo cadastrado com sucesso');
      navigate('/vulnerabilities');
    } catch (err) {
      const field = isHttpError(err) ? FIELD_BY_ERROR_CODE.get(err.code) : undefined;
      if (field) {
        setError(field, { type: 'server', message: errorMessage(err) }, { shouldFocus: true });
      } else {
        setSubmitError(errorMessage(err));
      }
    }
  }

  return (
    <>
      <PageHeader
        title="Cadastrar ativo"
        description="Registre um servidor, aplicação, rede ou banco de dados para incluí-lo nas varreduras de vulnerabilidades."
        breadcrumbs={[{ label: 'Vulnerabilidades', to: '/vulnerabilities' }, { label: 'Novo ativo' }]}
      />

      <form noValidate onSubmit={handleSubmit(onSubmit)} aria-busy={isSubmitting || undefined}>
        <Card
          className="max-w-2xl"
          title="Dados do ativo"
          subtitle="Campos marcados com * são obrigatórios."
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => navigate(-1)} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" loading={isSubmitting}>
                Salvar
              </Button>
            </div>
          }
        >
          <div className="space-y-5">
            {submitError && (
              <div
                role="alert"
                className={cn(
                  'flex items-start gap-2 rounded-lg px-4 py-3 text-sm ring-1',
                  SEVERITY_BADGE_CLASS.critical,
                )}
              >
                <Icons.AlertCircleIcon size={18} className="mt-0.5 shrink-0" />
                <p>{submitError}</p>
              </div>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField label="Nome" htmlFor="nome" required error={errors.name?.message}>
                <Input
                  id="nome"
                  type="text"
                  autoComplete="off"
                  placeholder="Ex.: Servidor Web 01"
                  required
                  invalid={Boolean(errors.name)}
                  aria-describedby={describedBy('nome', { error: errors.name?.message })}
                  {...register('name', {
                    required: 'Informe o nome do ativo.',
                    validate: (value) => {
                      const length = value.trim().length;
                      if (length < 3) return 'O nome deve ter ao menos 3 caracteres.';
                      if (length > 80) return 'O nome deve ter no máximo 80 caracteres.';
                      return true;
                    },
                  })}
                />
              </FormField>

              <FormField label="Tipo" htmlFor="tipo" required error={errors.type?.message}>
                <Select
                  id="tipo"
                  required
                  invalid={Boolean(errors.type)}
                  aria-describedby={describedBy('tipo', { error: errors.type?.message })}
                  {...register('type', {
                    validate: (value) => isAssetType(value) || 'Selecione o tipo do ativo.',
                  })}
                >
                  <option value="">Selecione o tipo</option>
                  {ASSET_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {ASSET_TYPE_LABEL[type]}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField label="Host" htmlFor="host" required error={errors.host?.message} hint={HOST_HINT}>
                <Input
                  id="host"
                  type="text"
                  mono
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="srv-web-01.empresa.com"
                  required
                  invalid={Boolean(errors.host)}
                  aria-describedby={describedBy('host', { error: errors.host?.message, hint: HOST_HINT })}
                  {...register('host', {
                    required: 'Informe o host do ativo.',
                    validate: (value) =>
                      isValidHost(value.trim()) ||
                      'Informe um nome DNS válido (ex.: srv-web-01.empresa.com) ou um IPv4.',
                  })}
                />
              </FormField>

              <FormField label="Endereço IP" htmlFor="ip" error={errors.ip?.message} hint={IP_HINT}>
                <Input
                  id="ip"
                  type="text"
                  mono
                  autoComplete="off"
                  inputMode="decimal"
                  placeholder="192.168.0.10"
                  invalid={Boolean(errors.ip)}
                  aria-describedby={describedBy('ip', { error: errors.ip?.message, hint: IP_HINT })}
                  {...register('ip', {
                    validate: (value) => {
                      const ip = value.trim();
                      return !ip || isValidIpv4(ip) || 'Informe um endereço IPv4 válido (ex.: 192.168.0.10).';
                    },
                  })}
                />
              </FormField>

              <FormField
                label="Descrição"
                htmlFor="descricao"
                error={errors.description?.message}
                hint={DESCRIPTION_HINT}
                className="sm:col-span-2"
              >
                <Textarea
                  id="descricao"
                  rows={4}
                  placeholder="Função do ativo, responsável, observações relevantes para a varredura…"
                  invalid={Boolean(errors.description)}
                  aria-describedby={describedBy('descricao', {
                    error: errors.description?.message,
                    hint: DESCRIPTION_HINT,
                  })}
                  {...register('description', {
                    maxLength: { value: 500, message: 'A descrição deve ter no máximo 500 caracteres.' },
                  })}
                />
              </FormField>
            </div>
          </div>
        </Card>
      </form>
    </>
  );
}
