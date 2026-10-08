import { falhar } from '../utils/resposta.js';
import { registrarAuditoria } from './auditoria.service.js';
import * as repo from '../repositories/departamento.repository.js';

// Departamentos: agrupam os resultados das campanhas. So o Administrador cria e exclui.

export const listar = repo.listar;

export async function criar(atorId: string, nome: string) {
  if ((await repo.resolverDepartamento(nome)) !== 'invalido')
    falhar(409, 'Departamento já cadastrado', 'DEPARTAMENTO_DUPLICADO');
  const dep = await repo.criar(nome);
  await registrarAuditoria(atorId, 'CRIAR_DEPARTAMENTO', dep.name);
  return { id: dep.id, nome: dep.name, usuarios: 0 };
}

/** Departamento com usuarios nao e excluido: quem decide para onde eles vao e o administrador. */
export async function excluir(atorId: string, id: string): Promise<void> {
  const dep = await repo.buscarComUsuarios(id);
  if (!dep) falhar(404, 'Departamento não encontrado', 'DEPARTAMENTO_NAO_ENCONTRADO');
  if (dep._count.users > 0) falhar(409, 'Departamento com usuários: mova-os antes de excluir', 'DEPARTAMENTO_EM_USO');
  await repo.excluir(dep.id);
  await registrarAuditoria(atorId, 'EXCLUIR_DEPARTAMENTO', dep.name);
}
