import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TrainingId } from './index';

/** Rotas públicas (antes do login). */
export type AuthStackParamList = {
  Login: undefined;
  ResetPassword: { email?: string } | undefined;
  ResetSent: undefined;
};

/** Rotas autenticadas (Administrador e Analista). */
export type AppStackParamList = {
  Home: undefined;
  NewCampaign: undefined;
  CampaignDetails: { campaignId: string };
  Training: { trainingId: TrainingId };
};

/** As duas pilhas juntas (configuração das URLs na web). */
export type RootStackParamList = AuthStackParamList & AppStackParamList;

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<
  AuthStackParamList,
  T
>;

export type AppScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<
  AppStackParamList,
  T
>;
