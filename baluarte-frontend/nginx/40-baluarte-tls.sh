#!/bin/sh
# Roda no entrypoint da imagem oficial do Nginx (/docker-entrypoint.d/), antes de o Nginx subir.
# Monta /etc/nginx/conf.d/default.conf conforme o que existe:
#   sem certificado                   -> só HTTP na 80 (como antes do B06)
#   com certificado                   -> HTTP na 80 + HTTPS na 443
#   com certificado e HTTPS_REDIRECT=1 -> HTTP na 80 só redireciona (308) + HTTPS na 443
# Certificado = /etc/nginx/certs/servidor.crt e servidor.key (volume ./certs/servidor do compose).
# Variáveis: HTTPS_REDIRECT (0|1, padrão 0), HTTPS_PORT (porta publicada do HTTPS, padrão 8443),
# HSTS_MAX_AGE (segundos, padrão 31536000).
set -eu

MODELOS=/etc/nginx/baluarte
CERTS=/etc/nginx/certs
DESTINO=/etc/nginx/conf.d/default.conf
HTTPS_REDIRECT=${HTTPS_REDIRECT:-0}
HTTPS_PORT=${HTTPS_PORT:-8443}
HSTS_MAX_AGE=${HSTS_MAX_AGE:-31536000}

log() { echo "$0: $*"; }

# Os valores vão para dentro da configuração por sed: só números passam.
case "$HTTPS_PORT" in ''|*[!0-9]*) log "HTTPS_PORT inválida ($HTTPS_PORT); usando 8443"; HTTPS_PORT=8443 ;; esac
case "$HSTS_MAX_AGE" in ''|*[!0-9]*) log "HSTS_MAX_AGE inválido ($HSTS_MAX_AGE); usando 31536000"; HSTS_MAX_AGE=31536000 ;; esac

montar() {
  # $1 = 1 para incluir o HTTPS; $2 = 1 para o HTTP só redirecionar
  {
    cat "$MODELOS/mapas.conf"
    if [ "$2" = 1 ]; then cat "$MODELOS/http-redireciona.conf"; else cat "$MODELOS/http.conf"; fi
    if [ "$1" = 1 ]; then cat "$MODELOS/https.conf"; fi
  } | sed -e "s/__HTTPS_PORT__/$HTTPS_PORT/g" -e "s/__HSTS_MAX_AGE__/$HSTS_MAX_AGE/g" > "$DESTINO"
}

if [ -s "$CERTS/servidor.crt" ] && [ -s "$CERTS/servidor.key" ]; then
  REDIRECIONA=0
  [ "$HTTPS_REDIRECT" = 1 ] && REDIRECIONA=1
  montar 1 "$REDIRECIONA"
  # Certificado ilegível ou corrompido não pode derrubar o frontend: volta para só HTTP, com aviso.
  if nginx -t -q 2>/tmp/nginx-teste.log; then
    if [ "$REDIRECIONA" = 1 ]; then
      log "HTTPS ligado na 443 (publicada em $HTTPS_PORT); HTTP na 80 redireciona para o HTTPS"
    else
      log "HTTPS ligado na 443 (publicada em $HTTPS_PORT); HTTP na 80 continua servindo (HTTPS_REDIRECT=0)"
    fi
  else
    log "AVISO: configuração HTTPS recusada pelo Nginx; subindo só em HTTP. Detalhe:"
    cat /tmp/nginx-teste.log
    montar 0 0
  fi
else
  [ "$HTTPS_REDIRECT" = 1 ] && log "AVISO: HTTPS_REDIRECT=1 ignorado: sem certificado não há para onde redirecionar"
  log "sem certificado em $CERTS (rode scripts/gerar-certificados.sh); só HTTP na 80"
  montar 0 0
fi
