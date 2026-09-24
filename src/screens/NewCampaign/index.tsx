import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import {
  Button,
  FormField,
  GroupPickerModal,
  GroupSelect,
  Header,
  Screen,
  SmallInput,
  TemplateSelect,
  TextArea,
  TextField,
} from '../../components';
import { useCampaigns, useToast } from '../../contexts';
import { daysFromTodayAtNine } from '../../data/campaigns';
import { DEFAULT_TARGET_GROUP } from '../../data/groups';
import { getTemplate } from '../../data/templates';
import { padTwo } from '../../lib/format';
import {
  CAMPAIGN_NAME_MAX,
  INTERNAL_DOMAIN,
  MESSAGES,
  validateNewCampaign,
  type NewCampaignErrors,
  type NewCampaignField,
  type ScheduleFields,
} from '../../lib/validation';
import { icons } from '../../theme';
import type { TemplateId } from '../../types';
import type { AppScreenProps } from '../../types/navigation';
import { styles } from './styles';

const SCHEDULE_HINT = 'A campanha dispara automaticamente na data e hora informadas.';
const DEFAULT_RECIPIENTS = [
  'ana.almeida@empresa.com',
  'bruno.barbosa@empresa.com',
  'carla.cardoso@empresa.com',
].join('\n');

/** Hoje + 7 dias às 09:00, já quebrado nos quatro campos. */
function defaultSchedule(now: Date): ScheduleFields {
  const date = daysFromTodayAtNine(now, 7);
  return {
    day: padTwo(date.getDate()),
    month: padTwo(date.getMonth() + 1),
    hour: padTwo(date.getHours()),
    minute: padTwo(date.getMinutes()),
  };
}

export function NewCampaignScreen({ navigation }: AppScreenProps<'NewCampaign'>) {
  const { scheduleCampaign } = useCampaigns();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  // Estado da seleção de modelo: começa vazio ("Selecione um modelo.").
  const [template, setTemplate] = useState<TemplateId | null>(null);
  const [targetGroup, setTargetGroup] = useState(DEFAULT_TARGET_GROUP);
  const [schedule, setSchedule] = useState<ScheduleFields>(() => defaultSchedule(new Date()));
  const [recipients, setRecipients] = useState(DEFAULT_RECIPIENTS);
  const [errors, setErrors] = useState<NewCampaignErrors>({});
  const [pickerVisible, setPickerVisible] = useState(false);

  function clearError(field: NewCampaignField) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  function updateSchedule(field: keyof ScheduleFields, value: string) {
    setSchedule((current) => ({ ...current, [field]: value.replace(/\D/g, '') }));
    clearError('schedule');
  }

  /** Completa com zero à esquerda ao sair do campo ("9" -> "09"). */
  function padScheduleField(field: keyof ScheduleFields) {
    setSchedule((current) =>
      current[field].length === 1 ? { ...current, [field]: padTwo(current[field]) } : current,
    );
  }

  function handleSubmit() {
    const result = validateNewCampaign(
      { name, template, targetGroup, schedule, recipients },
      new Date(),
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }

    const campaign = scheduleCampaign(result.value);
    showToast('Campanha agendada com sucesso');
    // Substitui a Nova campanha: o "voltar" dos Detalhes leva direto à Home.
    navigation.replace('CampaignDetails', { campaignId: campaign.id });
  }

  const templateHint = template ? getTemplate(template).description : MESSAGES.templateRequired;

  return (
    <Screen edges={['bottom']}>
      <Header title="Nova campanha" onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <FormField label="Nome da campanha" required error={errors.name}>
            <TextField
              value={name}
              onChangeText={(value) => {
                setName(value);
                clearError('name');
              }}
              placeholder="Ex.: Simulação Q4 – Financeiro"
              maxLength={CAMPAIGN_NAME_MAX}
              autoCapitalize="sentences"
              returnKeyType="done"
              invalid={Boolean(errors.name)}
              accessibilityLabel="Nome da campanha"
            />
          </FormField>

          <FormField label="Modelo de e-mail" required error={errors.template} hint={templateHint}>
            <TemplateSelect
              mode="radio"
              value={template}
              onChange={(value) => {
                setTemplate(value);
                clearError('template');
              }}
              invalid={Boolean(errors.template)}
            />
          </FormField>

          <FormField label="Grupo-alvo" required error={errors.targetGroup}>
            <GroupSelect
              value={targetGroup}
              onPress={() => setPickerVisible(true)}
              invalid={Boolean(errors.targetGroup)}
            />
          </FormField>

          <View>
            <View style={styles.scheduleRow}>
              <FormField label="Dia e mês">
                <View style={styles.inline}>
                  <SmallInput
                    value={schedule.day}
                    onChangeText={(value) => updateSchedule('day', value)}
                    onBlur={() => padScheduleField('day')}
                    placeholder="DD"
                    invalid={Boolean(errors.schedule)}
                    accessibilityLabel="Dia"
                  />
                  <Text style={styles.separator}>/</Text>
                  <SmallInput
                    value={schedule.month}
                    onChangeText={(value) => updateSchedule('month', value)}
                    onBlur={() => padScheduleField('month')}
                    placeholder="MM"
                    invalid={Boolean(errors.schedule)}
                    accessibilityLabel="Mês"
                  />
                </View>
              </FormField>

              <FormField label="Horário">
                <View style={styles.inline}>
                  <SmallInput
                    value={schedule.hour}
                    onChangeText={(value) => updateSchedule('hour', value)}
                    onBlur={() => padScheduleField('hour')}
                    placeholder="HH"
                    invalid={Boolean(errors.schedule)}
                    accessibilityLabel="Hora"
                  />
                  <Text style={styles.separator}>:</Text>
                  <SmallInput
                    value={schedule.minute}
                    onChangeText={(value) => updateSchedule('minute', value)}
                    onBlur={() => padScheduleField('minute')}
                    placeholder="MM"
                    invalid={Boolean(errors.schedule)}
                    accessibilityLabel="Minuto"
                  />
                </View>
              </FormField>
            </View>

            {errors.schedule ? (
              <Text style={styles.scheduleError} accessibilityRole="alert">
                {errors.schedule}
              </Text>
            ) : (
              <Text style={styles.scheduleHint}>{SCHEDULE_HINT}</Text>
            )}
          </View>

          <FormField
            label="Destinatários"
            required
            aside={`Somente ${INTERNAL_DOMAIN}`}
            error={errors.recipients}
          >
            <TextArea
              value={recipients}
              onChangeText={(value) => {
                setRecipients(value);
                clearError('recipients');
              }}
              placeholder={'nome.sobrenome@empresa.com\noutra.pessoa@empresa.com'}
              keyboardType="email-address"
              invalid={Boolean(errors.recipients)}
              accessibilityLabel="Destinatários"
              accessibilityHint="Um e-mail por linha ou separados por vírgula ou ponto e vírgula"
            />
          </FormField>

          <Button title="Agendar campanha" icon={icons.Calendar} onPress={handleSubmit} />
        </ScrollView>
      </KeyboardAvoidingView>

      <GroupPickerModal
        visible={pickerVisible}
        selected={targetGroup}
        onClose={() => setPickerVisible(false)}
        onSelect={(group) => {
          setTargetGroup(group);
          clearError('targetGroup');
          setPickerVisible(false);
        }}
      />
    </Screen>
  );
}
