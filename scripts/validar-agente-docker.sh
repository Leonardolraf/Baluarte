#!/usr/bin/env sh
# Validação real do agente de estação (B08) em contêineres, sem instalar nada na máquina:
#   1. gera uma CA e um certificado DESCARTÁVEIS (scripts/gerar-certificados.sh numa pasta temporária);
#   2. baixa o .deb oficial do osquery na versão fixa (agente/osquery-versao.conf) e confere o SHA-256;
#   3. sobe uma stack própria (scripts/validacao-agente/compose.yml): Postgres em tmpfs, a API deste
#      repositório, o Nginx do produto com HTTPS, OSV/NVD simulados e um Ubuntu 24.04 que roda o
#      instalador de verdade (agente/instalar-agente.sh) e o osqueryd apontando para https://app:443;
#   4. confere pela API, pelo HTTPS: inscrição, inventário (programas, SO, portas), GET /api/estacoes,
#      segundo ciclo sem duplicar e a verificação do B14 contra as bases simuladas;
#   5. derruba tudo e apaga a pasta temporária (CA, chaves, segredo).
#
#   sh scripts/validar-agente-docker.sh             # Git Bash no Windows, Linux ou macOS
#   sh scripts/validar-agente-docker.sh --manter    # deixa a stack no ar para olhar (derrube depois
#                                                   # com o comando que o script imprime)
#
# Não usa as portas nem o banco da stack principal (nenhuma porta é publicada) e a rede da stack
# não tem saída para a internet: o OSV e o NVD de verdade nunca são consultados.
# Precisa de: docker (com compose), openssl (o Git Bash já traz; sem ele, os certificados são
# gerados num contêiner), curl e sha256sum. O .deb fica em cache em ~/.cache/baluarte-agente
# (conferido pelo SHA-256 a cada execução).
set -eu

RAIZ=$(cd "$(dirname "$0")/.." && pwd)
VERSOES="$RAIZ/agente/osquery-versao.conf"
CACHE=${BALUARTE_CACHE:-$HOME/.cache/baluarte-agente}
MANTER=0
for arg in "$@"; do
  case "$arg" in
    --manter) MANTER=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Opção desconhecida: $arg (use --help)" >&2; exit 2 ;;
  esac
done

falhar() { echo "ERRO: $*" >&2; exit 1; }
passo() { echo; echo "==> $*"; }
command -v docker >/dev/null 2>&1 || falhar "docker não encontrado."
command -v sha256sum >/dev/null 2>&1 || falhar "sha256sum não encontrado."
command -v curl >/dev/null 2>&1 || falhar "curl não encontrado."
# Git Bash: caminhos C:/... para o Docker Desktop (pwd -W) e, só nas chamadas ao docker, sem a
# conversão automática de caminhos do MSYS (o openssl do Git Bash precisa dela).
caminho_docker() { (cd "$1" && (pwd -W 2>/dev/null || pwd)); }
COMPOSE_ARQ="$(caminho_docker "$RAIZ/scripts/validacao-agente")/compose.yml"
aleatorio() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

TMP=$(mktemp -d)
dc() { MSYS_NO_PATHCONV=1 docker compose -f "$COMPOSE_ARQ" "$@"; }
derrubar() {
  if [ "$MANTER" = 1 ]; then
    echo
    echo "Stack mantida (--manter). Para derrubar e apagar a pasta temporária com a CA e as chaves:"
    echo "  docker compose -p baluarte-validacao-agente down -v --remove-orphans && rm -rf \"$TMP\""
    return
  fi
  passo "derrubando a stack de validação e apagando a pasta temporária"
  dc --profile conferencia down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap derrubar EXIT
trap 'exit 130' INT TERM

# ---- 1. CA e certificado descartáveis -----------------------------------------------------
passo "gerando CA e certificado descartáveis em $TMP/certs"
OPCAO_DOCKER=
command -v openssl >/dev/null 2>&1 || OPCAO_DOCKER=--docker
CERTS_DIR="$TMP/certs" sh "$RAIZ/scripts/gerar-certificados.sh" $OPCAO_DOCKER | grep -E "CA nova|nomes:|impressão" || true
[ -s "$TMP/certs/ca.crt" ] && [ -s "$TMP/certs/servidor/servidor.crt" ] || falhar "certificados não gerados."

# ---- 2. Pacote oficial do osquery, conferido ----------------------------------------------
valor() { sed -n "s/^$1=\([0-9A-Za-z.]*\)\$/\1/p" "$VERSOES" | head -n 1; }
VERSAO=$(valor OSQUERY_VERSAO)
SHA=$(valor OSQUERY_DEB_AMD64_SHA256)
DEB="osquery_${VERSAO}-1.linux_amd64.deb"
mkdir -p "$CACHE"
if [ ! -s "$CACHE/$DEB" ] || [ "$(sha256sum "$CACHE/$DEB" | cut -d' ' -f1)" != "$SHA" ]; then
  passo "baixando $DEB (release oficial do osquery no GitHub)"
  curl -fsSL --proto '=https' -o "$CACHE/$DEB.parcial" \
    "https://github.com/osquery/osquery/releases/download/${VERSAO}/${DEB}" \
    || curl -fsSL --ssl-revoke-best-effort --proto '=https' -o "$CACHE/$DEB.parcial" \
      "https://github.com/osquery/osquery/releases/download/${VERSAO}/${DEB}"
  mv -f "$CACHE/$DEB.parcial" "$CACHE/$DEB"
fi
OBTIDO=$(sha256sum "$CACHE/$DEB" | cut -d' ' -f1)
[ "$OBTIDO" = "$SHA" ] || { rm -f "$CACHE/$DEB"; falhar "SHA-256 do $DEB não confere (esperado $SHA, obtido $OBTIDO)."; }
echo "SHA-256 do $DEB conferido: $OBTIDO"

# ---- 3. Stack ------------------------------------------------------------------------------
# Segredos só desta execução: só existem no ambiente deste processo e nos contêineres.
VAL_DB_SENHA=$(aleatorio)
VAL_JWT_SECRET=$(aleatorio)
VAL_ENROLL_SECRET=$(aleatorio)
VAL_CA="$(caminho_docker "$TMP/certs")/ca.crt"
VAL_CERTS_SERVIDOR=$(caminho_docker "$TMP/certs/servidor")
VAL_PACOTE="$(caminho_docker "$CACHE")/$DEB"
export VAL_DB_SENHA VAL_JWT_SECRET VAL_ENROLL_SECRET VAL_CA VAL_CERTS_SERVIDOR VAL_PACOTE

passo "construindo as imagens da API e do app deste repositório (pode levar alguns minutos)"
dc build backend app
passo "subindo db, backend, app (HTTPS), bases simuladas e a estação Ubuntu com o agente"
dc up -d --wait db backend app
dc up -d bases-simuladas agente

# ---- 4. Conferência ------------------------------------------------------------------------
passo "conferindo pela API (HTTPS do app, CA descartável)"
SITUACAO=0
dc --profile conferencia run --rm --no-deps conferencia || SITUACAO=$?

passo "instalador e osqueryd na estação (trechos do log)"
dc logs --no-color agente 2>/dev/null \
  | grep -E "\[agente\]|\[estacao\]|^agente-1 +\| +(-rw|--)|enroll|node_key|TLS|tls|Error|error|ERROR" \
  | grep -v -E "^agente-1 +\| +--(disable|watchdog|logger_min|config_refresh)" \
  | head -n 60 || true
passo "API (trechos do log)"
dc logs --no-color backend 2>/dev/null | grep -E "INSCREVER|agentes/osquery|erro|Error" | head -n 15 || true

if [ "$SITUACAO" != 0 ]; then
  echo
  echo "VALIDAÇÃO FALHOU (conferência saiu com $SITUACAO). Logs completos: rode de novo com --manter e"
  echo "  docker compose -p baluarte-validacao-agente logs agente backend app"
  exit 1
fi
echo
echo "VALIDAÇÃO DO AGENTE OK: instalador + osquery $VERSAO oficial inscritos e enviando inventário por HTTPS."
