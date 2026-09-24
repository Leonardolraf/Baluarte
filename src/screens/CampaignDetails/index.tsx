import { ScrollView, Text, View } from 'react-native';
import {
  Button,
  ButtonIcon,
  CampaignBanner,
  Header,
  InfoNote,
  ListHeader,
  RecipientListItem,
  Screen,
} from '../../components';
import { useCampaigns } from '../../contexts';
import { getTemplate } from '../../data/templates';
import { formatNumber } from '../../lib/format';
import { icons } from '../../theme';
import type { AppScreenProps } from '../../types/navigation';
import { styles } from './styles';

export function CampaignDetailsScreen({ navigation, route }: AppScreenProps<'CampaignDetails'>) {
  const { getCampaign } = useCampaigns();
  const campaign = getCampaign(route.params.campaignId);

  if (!campaign) {
    return (
      <Screen edges={['bottom']}>
        <Header title="Detalhes" onBack={() => navigation.goBack()} />
        <View style={styles.notFound}>
          <Text style={styles.notFoundTitle}>Campanha não encontrada</Text>
          <Button title="Voltar para campanhas" variant="outline" onPress={() => navigation.popToTop()} />
        </View>
      </Screen>
    );
  }

  const template = getTemplate(campaign.template);
  const isScheduled = campaign.status === 'scheduled';

  return (
    <Screen edges={['bottom']}>
      <Header title="Detalhes" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <CampaignBanner campaign={campaign} />

        <View style={styles.recipients} testID="recipients">
          <ListHeader
            title="Destinatários"
            subtitle={`Total ${formatNumber(campaign.metrics.recipients)}`}
            style={styles.listHeader}
          />
          {campaign.recipients.map((recipient) => (
            <RecipientListItem key={recipient.id} recipient={recipient} />
          ))}
          {isScheduled ? (
            <InfoNote style={styles.note}>
              Campanha ainda não disparada — as etapas aparecem depois do envio.
            </InfoNote>
          ) : null}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <ButtonIcon
          title="Ver material de treinamento"
          icon={icons.GraduationCap}
          onPress={() => navigation.navigate('Training', { trainingId: template.trainingId })}
        />
      </View>
    </Screen>
  );
}
