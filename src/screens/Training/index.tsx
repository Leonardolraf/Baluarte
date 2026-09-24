import { ScrollView, Text, View } from 'react-native';
import {
  BulletList,
  Button,
  Header,
  ProgressBar,
  Screen,
  SectionCard,
  Tag,
} from '../../components';
import { useToast, useTrainings } from '../../contexts';
import { findTraining } from '../../data/trainings';
import { colors, icons } from '../../theme';
import type { TrainingId } from '../../types';
import type { AppScreenProps } from '../../types/navigation';
import { styles } from './styles';

export function TrainingScreen({ navigation, route }: AppScreenProps<'Training'>) {
  const { isCompleted, toggleCompleted } = useTrainings();
  const { showToast } = useToast();
  // Na web o id vem da URL e pode ser qualquer texto.
  const training = findTraining(route.params.trainingId);

  if (!training) {
    return (
      <Screen edges={['bottom']}>
        <Header title="Treinamento" onBack={() => navigation.goBack()} />
        <View style={styles.notFound}>
          <Text style={styles.notFoundTitle}>Treinamento não encontrado</Text>
          <Button title="Voltar para campanhas" variant="outline" onPress={() => navigation.popToTop()} />
        </View>
      </Screen>
    );
  }

  const completed = isCompleted(training.id);

  function handleToggle(id: TrainingId) {
    const nowCompleted = toggleCompleted(id);
    if (nowCompleted) showToast('Treinamento concluído!');
  }

  return (
    <Screen edges={['bottom']}>
      <Header title="Treinamento" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.meta}>
          <Tag label={training.attackType} />
          <Text style={styles.code}>{training.moduleCode}</Text>
        </View>

        <Text style={styles.title} accessibilityRole="header">
          {training.title}
        </Text>
        <Text style={styles.summary}>{training.summary}</Text>

        <Text style={styles.progressLabel}>PROGRESSO</Text>
        <View style={styles.progressBar}>
          <ProgressBar value={completed ? 100 : 0} />
        </View>

        <View style={styles.cards}>
          {training.sections.map((section) => (
            <SectionCard key={section.heading} title={section.heading}>
              <Text style={styles.body}>{section.body}</Text>
            </SectionCard>
          ))}

          <SectionCard title="Sinais de alerta" subtitle="O que denuncia uma mensagem maliciosa">
            <BulletList
              items={training.warningSigns}
              icon={icons.TriangleAlert}
              iconColor={colors.severity.high}
            />
          </SectionCard>

          <SectionCard title="Boas práticas" subtitle="Como reagir com segurança">
            <BulletList
              items={training.bestPractices}
              icon={icons.CircleCheck}
              iconColor={colors.severity.low}
            />
          </SectionCard>

          <SectionCard title="Conclusão">
            <Text style={styles.body}>
              {completed
                ? 'Você concluiu este módulo. Obrigado por fortalecer a segurança da empresa.'
                : 'Leia todo o conteúdo e marque como concluído. A conclusão fica registrada no seu histórico.'}
            </Text>
            <Button
              title={completed ? 'Concluído' : 'Marcar como concluído'}
              variant={completed ? 'success' : 'primary'}
              icon={completed ? icons.CircleCheck : icons.GraduationCap}
              onPress={() => handleToggle(training.id)}
              accessibilityHint={
                completed ? 'Toque para desmarcar a conclusão' : 'Registra o módulo como concluído'
              }
            />
          </SectionCard>
        </View>
      </ScrollView>
    </Screen>
  );
}
