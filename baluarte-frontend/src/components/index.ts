// Barrel de componentes reutilizáveis.
export { SeverityBadge } from '@/components/Badge/SeverityBadge';
export type { SeverityBadgeProps } from '@/components/Badge/SeverityBadge';

export { CircularGauge } from '@/components/Gauge/CircularGauge';
export type { CircularGaugeProps } from '@/components/Gauge/CircularGauge';

export { VulnTable } from '@/components/Table/VulnTable';
export type { VulnTableProps } from '@/components/Table/VulnTable';

export { CampaignTable } from '@/components/Table/CampaignTable';
export type { CampaignTableProps } from '@/components/Table/CampaignTable';

export { Sidebar } from '@/components/Sidebar/Sidebar';
export { NAV_GROUPS, navGroupsForRole } from '@/components/Sidebar/navigation';
export type { NavGroup, NavItem } from '@/components/Sidebar/navigation';

export { Card, Plate, StatCard, KeyValueList } from '@/components/Card/Card';
export type { CardProps, PlateProps, StatCardProps, StatTone, KeyValueProps } from '@/components/Card/Card';

export { BaluarteMark, Wordmark } from '@/components/Brand/BaluarteMark';
export type { BaluarteMarkProps, WordmarkProps } from '@/components/Brand/BaluarteMark';

export { Tabs } from '@/components/Tabs/Tabs';
export type { TabsProps, TabItem } from '@/components/Tabs/Tabs';

export { EmptyState, ErrorState } from '@/components/EmptyState';
export type { EmptyStateProps, EmptyStateAction, ErrorStateProps } from '@/components/EmptyState';

export { LoadingSpinner, Skeleton } from '@/components/LoadingSpinner';
export type { LoadingSpinnerProps } from '@/components/LoadingSpinner';

export { ProtectedRoute } from '@/components/ProtectedRoute';
export type { ProtectedRouteProps } from '@/components/ProtectedRoute';

export { AppLayout } from '@/components/Layout/AppLayout';
export { PublicLayout } from '@/components/Layout/PublicLayout';
export { Topbar } from '@/components/Layout/Topbar';

// Primitivos de UI
export { Button, LinkButton } from '@/components/ui/Button';
export type { ButtonProps, LinkButtonProps } from '@/components/ui/Button';
export { buttonClasses } from '@/components/ui/buttonClasses';
export type { ButtonVariant, ButtonSize } from '@/components/ui/buttonClasses';
export { Input, Select, Textarea, Checkbox, Switch, Label, FormField } from '@/components/ui/Field';
export { describedBy } from '@/components/ui/describedBy';
export type {
  InputProps,
  SelectProps,
  TextareaProps,
  CheckboxProps,
  SwitchProps,
  FormFieldProps,
} from '@/components/ui/Field';
export { FormErrorBanner } from '@/components/ui/FormErrorBanner';
export type { FormErrorBannerProps } from '@/components/ui/FormErrorBanner';
export { PageHeader } from '@/components/ui/PageHeader';
export type { PageHeaderProps, Breadcrumb } from '@/components/ui/PageHeader';
export { StatusPill } from '@/components/ui/StatusPill';
export type { StatusPillProps } from '@/components/ui/StatusPill';
export {
  Table,
  TableContainer,
  THead,
  TBody,
  Th,
  Td,
  Tr,
  Pagination,
  TableEmptyRow,
} from '@/components/ui/Table';
export type { TableProps, ThProps, TdProps, TableRowProps, PaginationProps } from '@/components/ui/Table';

export * as Icons from '@/components/icons';
