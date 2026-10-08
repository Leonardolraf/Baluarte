#!/bin/sh
# "Estação" da validação do agente (B08): um Ubuntu limpo que roda o instalador de verdade
# (agente/instalar-agente.sh, com o .deb oficial e o SHA-256 conferido) e depois o osqueryd.
# Sem systemd no contêiner, o serviço não é ligado (--sem-servico): o osqueryd roda em primeiro
# plano, com as flags que o instalador gravou. O segredo chega por BALUARTE_ENROLL_SECRET.
set -eu

sh /baluarte/agente/instalar-agente.sh \
  --servidor "${SERVIDOR:-app:443}" \
  --ca /baluarte/ca.crt \
  --pacote /baluarte/osquery.deb \
  --sem-servico

echo "[estacao] arquivos gravados pelo instalador:"
ls -l /etc/osquery/
echo "[estacao] flags efetivas:"
grep '^--' /etc/osquery/osquery.flags

# Uma porta em escuta de verdade (o Ubuntu mínimo não tem nenhuma), para a coleta de portas
# ter o que mostrar. perl-base é essencial no Ubuntu, então não precisa instalar nada.
perl -MIO::Socket::INET -e '$s = IO::Socket::INET->new(LocalPort => 8022, Listen => 5, ReuseAddr => 1) or die "porta: $!"; while ($c = $s->accept) { close $c }' &

# --logger_tls_period=10 só para a validação não esperar 60 s por envio (vale a última flag).
exec /opt/osquery/bin/osqueryd --flagfile /etc/osquery/osquery.flags --logger_tls_period=10 --verbose
