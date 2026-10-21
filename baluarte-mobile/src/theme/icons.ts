/**
 * Ícones Lucide importados um a um (o barril `lucide-react-native` traria
 * todos os ~1.600 ícones para o bundle web).
 */
import type { LucideIcon } from 'lucide-react-native';
import AlarmClock from 'lucide-react-native/icons/alarm-clock';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import Briefcase from 'lucide-react-native/icons/briefcase';
import Calendar from 'lucide-react-native/icons/calendar';
import Check from 'lucide-react-native/icons/check';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import Eye from 'lucide-react-native/icons/eye';
import EyeOff from 'lucide-react-native/icons/eye-off';
import Gift from 'lucide-react-native/icons/gift';
import GraduationCap from 'lucide-react-native/icons/graduation-cap';
import Info from 'lucide-react-native/icons/info';
import Mail from 'lucide-react-native/icons/mail';
import Plus from 'lucide-react-native/icons/plus';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import Users from 'lucide-react-native/icons/users';
import X from 'lucide-react-native/icons/x';
import type { TemplateId } from '../types';

export type { LucideIcon };

export const icons = {
  AlarmClock,
  ArrowLeft,
  Briefcase,
  Calendar,
  Check,
  ChevronRight,
  CircleCheck,
  Eye,
  EyeOff,
  Gift,
  GraduationCap,
  Info,
  Mail,
  Plus,
  TriangleAlert,
  Users,
  X,
} satisfies Record<string, LucideIcon>;

/** Traço padrão dos ícones (mesmo peso visual do produto web). */
export const iconStroke = 1.75;

/** Ícone de cada modelo de e-mail. */
export const templateIcons: Record<TemplateId, LucideIcon> = {
  urgency: AlarmClock,
  authority: Briefcase,
  curiosity: Gift,
};
