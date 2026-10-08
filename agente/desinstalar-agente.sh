#!/usr/bin/env sh
# Remove o agente de estação do Baluarte (B08) de um Debian ou Ubuntu: para e desabilita o
# serviço, remove o pacote osquery (purge) e apaga o que o instalador gravou e o banco local do
# osquery (que guarda a chave da estação).
#
#   sudo sh agente/desinstalar-agente.sh
#
# Opções:
#   --manter-pacote   só apaga a configuração do Baluarte (flags, CA, segredo e banco local) e
#                     deixa o osquery instalado e parado
#   -h, --help        esta ajuda
#
# No painel, a estação continua listada (com o histórico e os achados) e passa a Offline depois
# da janela de 3 intervalos de coleta.
set -eu

falhar() { echo "ERRO: $*" >&2; exit 1; }
info() { echo "[agente] $*"; }

MANTER_PACOTE=0
for arg in "$@"; do
  case "$arg" in
    --manter-pacote) MANTER_PACOTE=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) falhar "opção desconhecida: $arg (use --help)" ;;
  esac
done

[ "$(id -u)" = 0 ] || falhar "rode como root (sudo)."

if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
  systemctl stop osqueryd 2>/dev/null || true
  systemctl disable osqueryd >/dev/null 2>&1 || true
  info "serviço osqueryd parado e desabilitado."
else
  # Sem systemd (contêiner): encerra o processo, se houver.
  pkill -x osqueryd 2>/dev/null || true
fi

# Arquivos do Baluarte e o banco local do osquery (RocksDB com a chave da estação e resultados
# pendentes), antes do purge (assim o dpkg remove /etc/osquery). Os caminhos são fixos: nada fora deles é tocado.
rm -f /etc/osquery/osquery.flags /etc/osquery/baluarte.secret /etc/osquery/baluarte-ca.crt
rm -rf /var/osquery/osquery.db
rm -f /var/osquery/osqueryd.pidfile /var/run/osqueryd.pidfile
if [ "$MANTER_PACOTE" = 0 ] && dpkg-query -W -f='${Status}' osquery 2>/dev/null | grep -q 'install ok installed'; then
  DEBIAN_FRONTEND=noninteractive dpkg --purge osquery >/dev/null
  info "pacote osquery removido (purge)."
fi

if [ "$MANTER_PACOTE" = 0 ]; then
  rm -rf /var/log/osquery
  rmdir /etc/osquery /var/osquery 2>/dev/null || true
fi
info "configuração do Baluarte e banco local do osquery apagados."
