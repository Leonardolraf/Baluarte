-- #9: responsavel pela maquina na estacao (Workstation.responsavelId). Sem FK (como o autor do
-- AuditLog): sobrevive a exclusao do usuario, resolvido por id na leitura. So aditiva e separavel
-- (pode entrar/sair sozinha, sem acoplar ao core do vinculo).

-- AlterTable
ALTER TABLE "Workstation" ADD COLUMN "responsavelId" TEXT;
