import { Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Placeholder } from './pages/Placeholder';
import { CadastroUsuario } from './pages/forms/CadastroUsuario';
import { CadastroAtivo } from './pages/forms/CadastroAtivo';
import { Campanha } from './pages/forms/Campanha';
import { AlterarSenha } from './pages/forms/AlterarSenha';
import { ResetSenha } from './pages/forms/ResetSenha';
import { Vulnerabilidades } from './pages/app/Vulnerabilidades';
import { VulnerabilidadeDetalhe } from './pages/app/VulnerabilidadeDetalhe';
import { Campanhas } from './pages/app/Campanhas';
import { CampanhaRelatorio } from './pages/app/CampanhaRelatorio';
import { Usuarios } from './pages/app/Usuarios';
import { Configuracoes } from './pages/app/Configuracoes';
import { Treinamento } from './pages/public/Treinamento';
import { QuemSomos } from './pages/public/QuemSomos';

function Protegido({ children }: { children: ReactNode }) {
  const { usuario, carregando } = useAuth();
  if (carregando) return <div className="p-8 text-slate-500">Carregando…</div>;
  if (!usuario) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Telas-formulario publicas (alvo das suites Robot da N2 AT1) */}
      <Route path="/cadastro-usuario" element={<CadastroUsuario />} />
      <Route path="/cadastro-ativo" element={<CadastroAtivo />} />
      <Route path="/campanha" element={<Campanha />} />
      <Route path="/alterar-senha" element={<AlterarSenha />} />
      <Route path="/reset-senha" element={<ResetSenha />} />

      {/* Telas publicas (marketing / treinamento pos-clique) */}
      <Route path="/quem-somos" element={<QuemSomos />} />
      <Route path="/treinamento/:token" element={<Treinamento />} />
      <Route
        element={
          <Protegido>
            <Layout />
          </Protegido>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/ativos" element={<Placeholder titulo="Ativos" />} />
        <Route path="/varreduras" element={<Placeholder titulo="Varreduras" />} />
        <Route path="/vulnerabilidades" element={<Vulnerabilidades />} />
        <Route path="/vulnerabilidades/:id" element={<VulnerabilidadeDetalhe />} />
        <Route path="/relatorios" element={<Placeholder titulo="Relatórios" />} />
        <Route path="/campanhas" element={<Campanhas />} />
        <Route path="/campanhas/:id" element={<CampanhaRelatorio />} />
        <Route path="/treinamentos" element={<Placeholder titulo="Treinamentos" />} />
        <Route path="/usuarios" element={<Usuarios />} />
        <Route path="/configuracoes" element={<Configuracoes />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
