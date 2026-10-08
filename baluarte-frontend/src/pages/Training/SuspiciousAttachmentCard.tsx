import { Card, LinkButton } from '@/components';
import { UploadIcon } from '@/components/icons';

/**
 * B23: anexo suspeito recebido na campanha. O envio sempre exige login (a análise ocupa o
 * antivírus e fica no histórico de quem enviou): pelo link do e-mail, o token vai na URL da tela
 * de análise para ela pré-selecionar a campanha depois do login; dentro do sistema, o id do evento.
 */
export function SuspiciousAttachmentCard({ to, viaLink }: { to: string; viaLink: boolean }) {
  return (
    <Card title="Recebeu um anexo?" subtitle="Não abra: envie para análise">
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Se a mensagem trazia um arquivo, não o abra. Envie-o para análise: o antivírus confere o arquivo e a
          equipe de segurança vê de qual campanha ele veio.
          {viaLink && ' É preciso entrar na sua conta do Baluarte.'}
        </p>
        <LinkButton
          to={to}
          variant="outline"
          className="w-full"
          leftIcon={<UploadIcon size={16} />}
          data-testid="send-attachment"
        >
          Enviar anexo para análise
        </LinkButton>
      </div>
    </Card>
  );
}
