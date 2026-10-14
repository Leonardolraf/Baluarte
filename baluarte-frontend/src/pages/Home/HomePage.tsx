import type { ComponentType } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { BaluarteMark, Card, LinkButton } from '@/components';
import { BugIcon, DashboardIcon, MailIcon, ShieldIcon, type IconProps } from '@/components/icons';

// Melhoria 11 — página pública de apresentação.
//
// Dois cuidados que valem mais que o layout:
//  1. Nada aqui afirma o que o sistema não faz. A varredura OWASP e o phishing são
//     SIMULADOS, e a página diz isso em texto, não em nota de rodapé. Linguagem de
//     marketing (número de clientes, "proteção garantida") não entra sem o Leo escrever.
//  2. Nenhuma direção visual nova: usa o design system atual (marca, Card, LinkButton,
//     tokens de tema). Quando o #25 definir a identidade, esta página acompanha sem refazer.

interface Recurso {
  icon: ComponentType<IconProps>;
  titulo: string;
  descricao: string;
}

const RECURSOS: readonly Recurso[] = [
  {
    icon: BugIcon,
    titulo: 'Risco técnico',
    descricao:
      'Varredura dos ativos cadastrados com as categorias do OWASP Top 10 2021, nota CVSS v3.1 calculada a partir do vetor e passos de remediação em cada achado.',
  },
  {
    icon: MailIcon,
    titulo: 'Risco humano',
    descricao:
      'Campanhas de phishing simulado restritas a colaboradores internos, com rastreamento individual e treinamento logo depois do clique.',
  },
  {
    icon: DashboardIcon,
    titulo: 'Um painel só',
    descricao:
      'O risco técnico e o humano no mesmo lugar, com índice de risco, evolução de 30 dias e os ativos que merecem atenção primeiro.',
  },
  {
    icon: ShieldIcon,
    titulo: 'Controle de acesso por perfil',
    descricao:
      'Administrador, Analista e Colaborador veem o que lhes cabe. A permissão é decidida no servidor a cada requisição, não escondendo botões na tela.',
  },
];

export default function HomePage() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="flex flex-col items-start gap-6">
        <BaluarteMark size={56} />
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold tracking-tight text-ink dark:text-white sm:text-4xl">
            Risco técnico e risco humano no mesmo painel
          </h1>
          <p className="max-w-2xl text-base text-slate-600 dark:text-slate-300 sm:text-lg">
            O Baluarte reúne a varredura de vulnerabilidades dos seus ativos e as campanhas de phishing
            simulado numa plataforma só, para empresas de médio porte que não têm um time de segurança
            dedicado.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <LinkButton to={isAuthenticated ? '/dashboard' : '/login'}>
            {isAuthenticated ? 'Ir ao dashboard' : 'Entrar na plataforma'}
          </LinkButton>
          <LinkButton to="/about" variant="outline">
            Conhecer o projeto
          </LinkButton>
        </div>
      </section>

      <section className="mt-14" aria-labelledby="recursos">
        <h2 id="recursos" className="text-lg font-semibold text-ink dark:text-white">
          O que a plataforma faz
        </h2>
        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {RECURSOS.map(({ icon: Icone, titulo, descricao }) => (
            <Card key={titulo}>
              <div className="flex items-start gap-3">
                <span
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-ink dark:bg-slate-800 dark:text-white"
                  aria-hidden="true"
                >
                  <Icone size={18} />
                </span>
                <div>
                  <h3 className="font-semibold text-ink dark:text-white">{titulo}</h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{descricao}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Escopo honesto, no corpo da página e não escondido: é um trabalho acadêmico. */}
      <section className="mt-14" aria-labelledby="escopo">
        <Card title="O que está simulado" subtitle="Para não haver dúvida sobre o alcance">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            O Baluarte é um trabalho de conclusão de curso em Engenharia de Software. A plataforma é real —
            contas, perfis de acesso, persistência, auditoria e relatórios funcionam de verdade —, mas{' '}
            <strong className="text-ink dark:text-white">
              a varredura de vulnerabilidades e o envio de phishing são simulados
            </strong>
            : nenhum ataque é executado contra sistema algum, e as campanhas só alcançam endereços internos
            cadastrados.
          </p>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            A página <em>Sobre</em> detalha os módulos, os perfis de acesso e a equipe.
          </p>
        </Card>
      </section>
    </div>
  );
}
