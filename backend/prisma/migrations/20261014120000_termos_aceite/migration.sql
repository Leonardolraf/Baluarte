-- Melhorias #5: aceite dos termos de uso. Nulo = a pessoa ainda nao aceitou.
-- So aditiva: coluna anulavel, sem default, nenhuma linha existente muda. Quem bloqueia os
-- recursos ate o aceite e a API; o banco so guarda o instante. A tabela "User" ja tem RLS
-- ligado e esta fechada para anon/authenticated (DT13): coluna nova herda isso.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "termosAceitosEm" TIMESTAMP(3);
