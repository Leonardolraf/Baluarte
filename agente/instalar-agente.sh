#!/usr/bin/env sh
# Instala o agente de estação do Baluarte (B08) num Debian ou Ubuntu: o pacote .deb OFICIAL do
# osquery, na versão fixa de agente/osquery-versao.conf (SHA-256 conferido antes de instalar),
# com as flags que apontam para o servidor, a CA local e o segredo de inscrição.
#
#   sudo BALUARTE_ENROLL_SECRET='<segredo>' sh agente/instalar-agente.sh --servidor 192.168.0.10:8443 --ca certs/ca.crt
#   sudo sh agente/instalar-agente.sh --servidor 192.168.0.10:8443 --ca certs/ca.crt   # pergunta o segredo
#   sudo sh agente/instalar-agente.sh --servidor api.exemplo.com:443 --segredo-arquivo /root/segredo
#
# Opções:
#   --servidor HOST:PORTA    obrigatório. Endereço HTTPS do Baluarte, sem https:// (o nome precisa
#                            estar no certificado: gerar-certificados.sh com EXTRA_SAN)
#   --ca ARQUIVO             certificado da CA local (certs/ca.crt do B06; NUNCA a ca.key). Sem ele,
#                            o agente confia nas autoridades públicas do pacote do osquery
#   --segredo-arquivo ARQ    arquivo com o segredo de inscrição (o OSQUERY_ENROLL_SECRET do servidor).
#                            Alternativas: a variável BALUARTE_ENROLL_SECRET ou, sem nenhuma das
#                            duas, a pergunta no terminal (sem eco). Nunca passe o segredo como
#                            argumento: ele apareceria na lista de processos e no histórico
#   --pacote ARQUIVO.deb     usa um .deb já baixado (o SHA-256 é conferido do mesmo jeito)
#   --sem-servico            não liga o serviço do systemd (contêiner, validação); só mostra o comando
#   -h, --help               esta ajuda
#
# O que fica na estação:
#   /etc/osquery/osquery.flags       flags (sem segredo), a partir de agente/osquery.flags.modelo
#   /etc/osquery/baluarte.secret     segredo, dono root, permissão 600
#   /etc/osquery/baluarte-ca.crt     CA local (só com --ca)
#   serviço osqueryd (systemd), habilitado na inicialização
# Rodar de novo atualiza as flags, a CA e o segredo e reinicia o serviço. Para remover:
# agente/desinstalar-agente.sh.
set -eu

DIR=$(cd "$(dirname "$0")" && pwd)
VERSOES="$DIR/osquery-versao.conf"
MODELO="$DIR/osquery.flags.modelo"
ETC=/etc/osquery
FLAGS="$ETC/osquery.flags"
SEGREDO_ARQ="$ETC/baluarte.secret"
CA_DESTINO="$ETC/baluarte-ca.crt"
CA_PACOTE=/opt/osquery/share/osquery/certs/certs.pem
TAMANHO_MINIMO_SEGREDO=16

falhar() { echo "ERRO: $*" >&2; exit 1; }
info() { echo "[agente] $*"; }

SERVIDOR=
CA=
SEGREDO_ENTRADA=
PACOTE=
SEM_SERVICO=0
while [ $# -gt 0 ]; do
  case "$1" in
    --servidor) [ $# -ge 2 ] || falhar "--servidor precisa de um valor"; SERVIDOR=$2; shift 2 ;;
    --ca) [ $# -ge 2 ] || falhar "--ca precisa de um arquivo"; CA=$2; shift 2 ;;
    --segredo-arquivo) [ $# -ge 2 ] || falhar "--segredo-arquivo precisa de um arquivo"; SEGREDO_ENTRADA=$2; shift 2 ;;
    --pacote) [ $# -ge 2 ] || falhar "--pacote precisa de um arquivo"; PACOTE=$2; shift 2 ;;
    --sem-servico) SEM_SERVICO=1; shift ;;
    -h|--help) sed -n '2,31p' "$0"; exit 0 ;;
    *) falhar "opção desconhecida: $1 (use --help)" ;;
  esac
done

# ---- Conferências antes de mexer na máquina --------------------------------------------
[ "$(id -u)" = 0 ] || falhar "rode como root (sudo)."
command -v dpkg >/dev/null 2>&1 || falhar "este instalador é para Debian/Ubuntu (dpkg). Em Windows use instalar-agente.ps1."
command -v sha256sum >/dev/null 2>&1 || falhar "sha256sum não encontrado (pacote coreutils)."
[ -r "$VERSOES" ] || falhar "não achei $VERSOES (copie a pasta agente/ inteira)."
[ -r "$MODELO" ] || falhar "não achei $MODELO (copie a pasta agente/ inteira)."

[ -n "$SERVIDOR" ] || falhar "informe --servidor HOST:PORTA (ex.: 192.168.0.10:8443)."
echo "$SERVIDOR" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]{0,252})?:[0-9]{1,5}$' \
  || falhar "--servidor deve ser HOST:PORTA, sem https:// nem caminho (recebido: $SERVIDOR)."

# Valor de uma chave do arquivo de versões (só letras, números e ponto passam).
valor() { sed -n "s/^$1=\([0-9A-Za-z.]*\)\$/\1/p" "$VERSOES" | head -n 1; }
VERSAO=$(valor OSQUERY_VERSAO)
ARQ=$(dpkg --print-architecture)
case "$ARQ" in
  amd64) SHA_ESPERADO=$(valor OSQUERY_DEB_AMD64_SHA256) ;;
  arm64) SHA_ESPERADO=$(valor OSQUERY_DEB_ARM64_SHA256) ;;
  *) falhar "arquitetura $ARQ sem pacote oficial do osquery (só amd64 e arm64)." ;;
esac
[ -n "$VERSAO" ] && [ ${#SHA_ESPERADO} = 64 ] || falhar "versão ou SHA-256 ausente em $VERSOES."
NOME_DEB="osquery_${VERSAO}-1.linux_${ARQ}.deb"
URL="https://github.com/osquery/osquery/releases/download/${VERSAO}/${NOME_DEB}"

if [ -n "$CA" ]; then
  [ -r "$CA" ] || falhar "CA não encontrada: $CA"
  grep -q 'PRIVATE KEY' "$CA" && falhar "$CA contém uma CHAVE PRIVADA. Entregue só o certs/ca.crt, nunca a ca.key."
  grep -q 'BEGIN CERTIFICATE' "$CA" || falhar "$CA não parece um certificado PEM."
fi

# Segredo: arquivo, variável ou pergunta no terminal. Nunca é impresso.
if [ -n "$SEGREDO_ENTRADA" ]; then
  [ -r "$SEGREDO_ENTRADA" ] || falhar "arquivo do segredo ilegível: $SEGREDO_ENTRADA"
  SEGREDO=$(cat "$SEGREDO_ENTRADA")
elif [ -n "${BALUARTE_ENROLL_SECRET:-}" ]; then
  SEGREDO=$BALUARTE_ENROLL_SECRET
elif [ -t 0 ]; then
  printf 'Segredo de inscrição (OSQUERY_ENROLL_SECRET do servidor): '
  stty -echo; trap 'stty echo' EXIT INT TERM
  read -r SEGREDO || true
  stty echo; trap - EXIT INT TERM
  echo
else
  falhar "sem segredo: use BALUARTE_ENROLL_SECRET, --segredo-arquivo ou rode num terminal."
fi
unset BALUARTE_ENROLL_SECRET
# Tira espaços e quebras de linha das pontas (o servidor também ignora).
SEGREDO=$(printf '%s' "$SEGREDO" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
[ ${#SEGREDO} -ge $TAMANHO_MINIMO_SEGREDO ] || falhar "segredo com menos de $TAMANHO_MINIMO_SEGREDO caracteres (o servidor recusaria)."
case "$SEGREDO" in *"
"*) falhar "o segredo tem mais de uma linha." ;; esac

# ---- Pacote: baixa (ou usa o informado) e confere o SHA-256 ------------------------------
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
if [ -z "$PACOTE" ]; then
  PACOTE="$TMP/$NOME_DEB"
  info "baixando $URL"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --proto '=https' --tlsv1.2 -o "$PACOTE" "$URL" || falhar "falha no download."
  elif command -v wget >/dev/null 2>&1; then
    wget -q --https-only -O "$PACOTE" "$URL" || falhar "falha no download."
  else
    falhar "sem curl nem wget. Baixe $URL em outra máquina e use --pacote."
  fi
fi
[ -r "$PACOTE" ] || falhar "pacote não encontrado: $PACOTE"
SHA_OBTIDO=$(sha256sum "$PACOTE" | cut -d' ' -f1)
if [ "$SHA_OBTIDO" != "$SHA_ESPERADO" ]; then
  falhar "SHA-256 do pacote não confere (esperado $SHA_ESPERADO, obtido $SHA_OBTIDO). Nada foi instalado."
fi
info "SHA-256 conferido: $SHA_OBTIDO ($NOME_DEB)"

# ---- Instalação ------------------------------------------------------------------------
TEM_SYSTEMD=0
[ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1 && TEM_SYSTEMD=1
# Reinstalação: para o serviço antes de trocar os arquivos.
[ "$TEM_SYSTEMD" = 1 ] && systemctl stop osqueryd 2>/dev/null || true

INSTALADA=$(dpkg-query -W -f='${Status} ${Version}' osquery 2>/dev/null || true)
if [ "$INSTALADA" = "install ok installed ${VERSAO}-1.linux" ]; then
  info "osquery $VERSAO já instalado; só atualiza a configuração."
else
  info "instalando osquery $VERSAO"
  DEBIAN_FRONTEND=noninteractive dpkg -i "$PACOTE" >/dev/null \
    || falhar "dpkg -i falhou (dependências: libc6 e zlib1g; tente apt-get install -f)."
fi
[ -x /opt/osquery/bin/osqueryd ] || falhar "osqueryd não ficou em /opt/osquery/bin."

umask 077
mkdir -p "$ETC"
# Segredo: arquivo temporário já com 600 e troca atômica (printf é embutido no shell: o
# segredo não aparece na lista de processos).
printf '%s' "$SEGREDO" > "$ETC/.baluarte.secret.novo"
chmod 600 "$ETC/.baluarte.secret.novo"
chown root:root "$ETC/.baluarte.secret.novo"
mv -f "$ETC/.baluarte.secret.novo" "$SEGREDO_ARQ"
SEGREDO=

if [ -n "$CA" ]; then
  cp "$CA" "$CA_DESTINO"
  chmod 644 "$CA_DESTINO"
  CA_FLAG=$CA_DESTINO
else
  [ -r "$CA_PACOTE" ] || falhar "sem --ca e sem o pacote de autoridades do osquery em $CA_PACOTE."
  CA_FLAG=$CA_PACOTE
fi

sed -e "s|__SERVIDOR__|$SERVIDOR|g" -e "s|__CA__|$CA_FLAG|g" -e "s|__SEGREDO__|$SEGREDO_ARQ|g" "$MODELO" > "$FLAGS.novo"
grep -q '__[A-Z]*__' "$FLAGS.novo" && falhar "sobrou marcador sem valor em $FLAGS.novo."
chmod 644 "$FLAGS.novo"
mv -f "$FLAGS.novo" "$FLAGS"
info "flags em $FLAGS (servidor $SERVIDOR, CA $CA_FLAG); segredo em $SEGREDO_ARQ (600)"

# ---- Serviço ---------------------------------------------------------------------------
COMANDO="/opt/osquery/bin/osqueryd --flagfile $FLAGS"
if [ "$SEM_SERVICO" = 1 ]; then
  info "--sem-servico: inicie com: $COMANDO"
elif [ "$TEM_SYSTEMD" = 1 ]; then
  systemctl daemon-reload
  systemctl enable osqueryd >/dev/null 2>&1
  systemctl restart osqueryd
  sleep 3
  systemctl is-active --quiet osqueryd || falhar "o serviço osqueryd não ficou ativo: journalctl -u osqueryd -n 50"
  info "serviço osqueryd ativo e habilitado na inicialização."
else
  info "AVISO: sem systemd nesta máquina; o serviço não foi ligado. Inicie com: $COMANDO"
fi

cat <<EOF
[agente] pronto. Para conferir:
  - no painel do Baluarte, menu Estações: a máquina aparece logo após a inscrição e o
    inventário chega no primeiro ciclo de coleta (até alguns minutos);
  - na estação: journalctl -u osqueryd -f  (erros de TLS ou de inscrição aparecem aqui);
  - teste manual, com o serviço parado: $COMANDO --verbose
EOF
