import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
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
import { IS_API_MODE } from '../../lib/config';
import { formatNumber } from '../../lib/format';
import { colors, icons } from '../../theme';
import type { Campaign } from '../../types';
import type { AppScreenProps } from '../../types/navigation';
import { styles } from './styles';

export function CampaignDetailsScreen({ navigation, route }: AppScreenProps<'CampaignDetails'>) {
  const { campaignId } = route.params;
  const { getCampaign, loadCampaignDetail } = useCampaigns();
  const base = getCampaign(campaignId);
  // No modo API, o detalhe (funil, destinatários) vem de GET /campanhas/:id.
  const [detail, setDetail] = useState<Campaign | undefined>(base);
  const [loadingDetail, setLoadingDetail] = useState(IS_API_MODE && !base);

  useEffect(() => {
    if (!IS_API_MODE) return;
    let active = true;
    setLoadingDetail(!base);
    loadCampaignDetail(campaignId)
      .then((full) => {
        if (active && full) setDetail(full);
      })
      .finally(() => {
        if (active) setLoadingDetail(false);
      });
    return () => {
      active = false;
    };
    // Busca uma vez por campanha; loadCampaignDetail muda de identidade com a lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const campaign = detail ?? base;

  if (loadingDetail && !campaign) {
    return (
      <Screen edges={['bottom']}>
        <Header title="Detalhes" onBack={() => navigation.goBack()} />
        <View style={styles.notFound}>
          <ActivityIndicator color={colors.text.secondary} />
        </View>
      </Screen>
    );
  }

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
