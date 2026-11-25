#!/bin/sh
# Aplica cada mutacao na worktree descartavel, roda o teste (vermelho), reverte e roda de novo (verde).
M="${1:?uso: sh rodar-mutacoes.sh <worktree descartavel> <esta pasta>}"
D="${2:?uso: sh rodar-mutacoes.sh <worktree descartavel> <esta pasta>}"
cd $M/backend
rodar() { # nome patch teste
  nome=$1; patch=$2; teste=$3
  git checkout -q -- src
  git apply "$D/$patch" || { echo "patch $patch nao aplicou"; exit 1; }
  { echo "# $nome - MUTACAO APLICADA ($patch) - $(date -Iseconds)"; echo "# comando: node --import tsx --test $teste"; git diff --stat; echo; } > "$D/$nome-vermelho.txt"
  node --import tsx --test "$teste" >> "$D/$nome-vermelho.txt" 2>&1; echo "# exit=$?" >> "$D/$nome-vermelho.txt"
  git checkout -q -- src
  { echo "# $nome - MUTACAO REVERTIDA (codigo original) - $(date -Iseconds)"; echo "# comando: node --import tsx --test $teste"; echo "# git diff -- src (vazio = original):"; git diff -- src; echo; } > "$D/$nome-verde.txt"
  node --import tsx --test "$teste" >> "$D/$nome-verde.txt" 2>&1; echo "# exit=$?" >> "$D/$nome-verde.txt"
}
rodar M1 M1-sem-exigeToken.patch tests/seguranca/autorizacao.test.ts
rodar M2 M2-faixa-alto.patch tests/unidade/cvss-catalogo.test.ts
rodar M3 M3-sem-limite-login.patch tests/seguranca/conta-forca-bruta.test.ts
rodar M4 M4-analista-exclui-usuario.patch tests/seguranca/autorizacao.test.ts
git checkout -q -- src
echo FIM
