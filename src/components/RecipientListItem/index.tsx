import { Text, View } from 'react-native';
import { layout, spacing } from '../../theme';
import type { Recipient } from '../../types';
import { Avatar } from '../Avatar';
import { ListDivider } from '../ListDivider';
import { StageBadge } from '../StageBadge';
import { styles } from './styles';

interface RecipientListItemProps {
  recipient: Recipient;
}

/** Destinatário: avatar com iniciais, nome e etapa colorida. */
export function RecipientListItem({ recipient }: RecipientListItemProps) {
  return (
    <View>
      <View style={styles.row}>
        <Avatar name={recipient.name} />
        <View style={styles.content}>
          <Text style={styles.name} numberOfLines={1}>
            {recipient.name}
          </Text>
          <StageBadge stage={recipient.stage} />
        </View>
      </View>
      <ListDivider inset={layout.avatar + spacing.lg} />
    </View>
  );
}
