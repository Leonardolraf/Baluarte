#!/usr/bin/env sh
# Gera a autoridade certificadora (CA) local e o certificado TLS do servidor (Nginx do
# serviço `app`, porta 8443). Uso só no ambiente local e na demonstração: em produção o
# HTTPS vem da plataforma (Vercel, Railway).
#
#   sh scripts/gerar-certificados.sh              # usa o openssl da máquina (o Git Bash já traz)
#   sh scripts/gerar-certificados.sh --docker     # roda o openssl num contêiner Alpine
#   sh scripts/gerar-certificados.sh --nova-ca    # descarta a CA atual e cria outra
#
# Saída (pasta fora do git, ver .gitignore):
#   certs/ca.crt                    certificado da CA: é ele que o navegador e o agente osquery confiam
#   certs/ca.key                    chave da CA (NUNCA sai da máquina nem vai para o repositório)
#   certs/servidor/servidor.crt     certificado do servidor, montado no Nginx
#   certs/servidor/servidor.key     chave do servidor, montada no Nginx
#
# A CA existente é reaproveitada (o certificado do servidor é refeito a cada execução), para
# que navegadores e agentes que já confiam nela continuem funcionando.
#
# Variáveis opcionais:
#   EXTRA_SAN       nomes a mais no certificado, separados por vírgula. Ex. para um agente
#                   em outra máquina da rede: EXTRA_SAN="DNS:pc-do-leo.lan,IP:192.168.0.10"
#   CERTS_DIR       pasta de saída (padrão: certs/ na raiz do repositório)
#   DIAS_CA         validade da CA em dias (padrão 3650)
#   DIAS_SERVIDOR   validade do certificado do servidor em dias (padrão 825, o máximo que
#                   o macOS/iOS aceitam para certificado de servidor)
#
# A CA tem "name constraints": só vale para nomes locais (localhost, o nome do serviço, o nome
# desta máquina, *.local, *.lan, *.internal, *.home.arpa) e IPs de loopback e de rede privada.
# Se a chave vazar, ela não serve para se passar por um site público, mesmo num navegador que
# confia nela. Um nome fora dessa lista exige `--nova-ca` com o nome em EXTRA_SAN.
set -eu

RAIZ=$(cd "$(dirname "$0")/.." && pwd)
DIR=${CERTS_DIR:-$RAIZ/certs}
DIAS_CA=${DIAS_CA:-3650}
DIAS_SERVIDOR=${DIAS_SERVIDOR:-825}
EXTRA_SAN=${EXTRA_SAN:-}
IMAGEM_OPENSSL=alpine:3.22

USAR_DOCKER=0
NOVA_CA=0
DENTRO_DO_CONTEINER=0
for arg in "$@"; do
  case "$arg" in
    --docker) USAR_DOCKER=1 ;;
    --nova-ca) NOVA_CA=1 ;;
    --dentro-do-conteiner) DENTRO_DO_CONTEINER=1 ;;
    -h|--help) sed -n '2,33p' "$0"; exit 0 ;;
    *) echo "Opção desconhecida: $arg (use --help)" >&2; exit 2 ;;
  esac
done

falhar() { echo "ERRO: $*" >&2; exit 1; }

case "$DIAS_CA$DIAS_SERVIDOR" in ''|*[!0-9]*) falhar "DIAS_CA e DIAS_SERVIDOR precisam ser números." ;; esac

# Nomes do certificado: localhost, o serviço do compose (`app`), o nome que um contêiner usa
# para chegar à máquina (`host.docker.internal`), o nome desta máquina e os loopbacks.
# MAQUINA vem de fora quando o script roda dentro do contêiner (lá o hostname é outro).
MAQUINA=${MAQUINA:-$(hostname 2>/dev/null | tr 'A-Z' 'a-z' || true)}
SAN="DNS:localhost,DNS:app,DNS:host.docker.internal,IP:127.0.0.1,IP:::1"
case "$MAQUINA" in
  ''|*[!a-z0-9.-]*|localhost) MAQUINA= ;;
  *) SAN="$SAN,DNS:$MAQUINA" ;;
esac
if [ -n "$EXTRA_SAN" ]; then
  for item in $(echo "$EXTRA_SAN" | tr ',' ' '); do
    case "$item" in
      DNS:*) nome=${item#DNS:}; case "$nome" in ''|*[!A-Za-z0-9.*-]*) falhar "nome inválido em EXTRA_SAN: $item" ;; esac ;;
      IP:*) ip=${item#IP:}; case "$ip" in ''|*[!0-9A-Fa-f:.]*) falhar "IP inválido em EXTRA_SAN: $item" ;; esac ;;
      *) falhar "EXTRA_SAN aceita só DNS:<nome> e IP:<endereço> (recebido: $item)" ;;
    esac
    SAN="$SAN,$item"
  done
fi

# --docker: roda este mesmo script dentro de um Alpine com openssl, montando a pasta de saída.
if [ "$USAR_DOCKER" = 1 ] && [ "$DENTRO_DO_CONTEINER" = 0 ]; then
  command -v docker >/dev/null 2>&1 || falhar "docker não encontrado."
  mkdir -p "$DIR/servidor"
  # No Windows (Git Bash), `pwd -W` dá o caminho C:/... que o Docker Desktop entende.
  DIR_HOST=$(cd "$DIR" && (pwd -W 2>/dev/null || pwd))
  SCRIPTS_HOST=$(cd "$RAIZ/scripts" && (pwd -W 2>/dev/null || pwd))
  ARGS="--dentro-do-conteiner"
  [ "$NOVA_CA" = 1 ] && ARGS="$ARGS --nova-ca"
  # Sem isto o Git Bash reescreve "/certs" e "/scripts" como caminhos do Windows.
  export MSYS_NO_PATHCONV=1
  exec docker run --rm \
    -v "$DIR_HOST:/certs" -v "$SCRIPTS_HOST:/scripts:ro" \
    -e CERTS_DIR=/certs -e MAQUINA="$MAQUINA" -e EXTRA_SAN="$EXTRA_SAN" \
    -e DIAS_CA="$DIAS_CA" -e DIAS_SERVIDOR="$DIAS_SERVIDOR" \
    "$IMAGEM_OPENSSL" sh -c "apk add --no-cache openssl >/dev/null && sh /scripts/gerar-certificados.sh $ARGS"
fi

command -v openssl >/dev/null 2>&1 || falhar "openssl não encontrado. Use --docker."

mkdir -p "$DIR/servidor"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
umask 077

# Restrições de nome da CA (RFC 5280, 4.2.1.10). Um nome sem ponto inicial vale para ele e
# para os subdomínios; IPs vão como endereço/máscara.
RESTRICOES="permitted;DNS:localhost,permitted;DNS:app,permitted;DNS:host.docker.internal"
RESTRICOES="$RESTRICOES,permitted;DNS:local,permitted;DNS:lan,permitted;DNS:internal,permitted;DNS:home.arpa"
[ -n "$MAQUINA" ] && RESTRICOES="$RESTRICOES,permitted;DNS:$MAQUINA"
for item in $(echo "$EXTRA_SAN" | tr ',' ' '); do
  case "$item" in
    DNS:*) RESTRICOES="$RESTRICOES,permitted;DNS:$(echo "${item#DNS:}" | sed 's/^\*\.//')" ;;
    IP:*.*) RESTRICOES="$RESTRICOES,permitted;IP:${item#IP:}/255.255.255.255" ;;
  esac
done
RESTRICOES="$RESTRICOES,permitted;IP:127.0.0.0/255.0.0.0,permitted;IP:10.0.0.0/255.0.0.0"
RESTRICOES="$RESTRICOES,permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0"
RESTRICOES="$RESTRICOES,permitted;IP:::1/ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"
RESTRICOES="$RESTRICOES,permitted;IP:fc00::/fe00::"

if [ "$NOVA_CA" = 1 ] || [ ! -s "$DIR/ca.key" ] || [ ! -s "$DIR/ca.crt" ]; then
  cat > "$TMP/ca.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
x509_extensions = v3_ca
[dn]
O = Baluarte
OU = Ambiente local (desenvolvimento)
CN = Baluarte CA local
[v3_ca]
basicConstraints = critical, CA:true, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
nameConstraints = critical, $RESTRICOES
EOF
  openssl ecparam -name prime256v1 -genkey -noout -out "$DIR/ca.key"
  openssl req -x509 -new -sha256 -days "$DIAS_CA" -key "$DIR/ca.key" -config "$TMP/ca.cnf" -out "$DIR/ca.crt"
  echo "CA nova criada: $DIR/ca.crt (navegadores e agentes que confiavam na anterior precisam confiar nesta)."
else
  echo "CA existente reaproveitada: $DIR/ca.crt"
fi

cat > "$TMP/servidor.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
[dn]
O = Baluarte
CN = localhost
[v3_servidor]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
subjectAltName = $SAN
EOF
openssl ecparam -name prime256v1 -genkey -noout -out "$TMP/servidor.key"
openssl req -new -sha256 -key "$TMP/servidor.key" -config "$TMP/servidor.cnf" -out "$TMP/servidor.csr"
openssl x509 -req -sha256 -days "$DIAS_SERVIDOR" -in "$TMP/servidor.csr" \
  -CA "$DIR/ca.crt" -CAkey "$DIR/ca.key" -set_serial "0x$(openssl rand -hex 16)" \
  -extfile "$TMP/servidor.cnf" -extensions v3_servidor -out "$TMP/servidor.crt" 2>/dev/null

# Confere a cadeia antes de instalar (inclui as restrições de nome da CA).
if ! openssl verify -CAfile "$DIR/ca.crt" "$TMP/servidor.crt" >/dev/null 2>&1; then
  openssl verify -CAfile "$DIR/ca.crt" "$TMP/servidor.crt" >&2 || true
  falhar "o certificado não valida contra a CA. Nome fora das restrições da CA? Rode de novo com --nova-ca."
fi

mv "$TMP/servidor.key" "$DIR/servidor/servidor.key"
mv "$TMP/servidor.crt" "$DIR/servidor/servidor.crt"
# As chaves ficam só para o dono; os certificados são públicos. (O Nginx lê como root.)
chmod 600 "$DIR/ca.key" "$DIR/servidor/servidor.key"
chmod 644 "$DIR/ca.crt" "$DIR/servidor/servidor.crt"

echo "Certificado do servidor: $DIR/servidor/servidor.crt"
echo "  nomes: $SAN"
echo "  validade: $DIAS_SERVIDOR dias"
echo "  impressão digital da CA (SHA-256): $(openssl x509 -in "$DIR/ca.crt" -noout -fingerprint -sha256 | cut -d= -f2)"
echo
echo "Próximos passos:"
echo "  docker compose up --build -d app       # HTTPS em https://localhost:8443 (HTTP segue na 8081)"
echo "  curl --cacert certs/ca.crt https://localhost:8443/"
echo "  osquery: --tls_server_certs=<caminho>/certs/ca.crt --tls_hostname=localhost:8443"
