#!/usr/bin/env bash
# PROTOTYPE (issue #1): start a local BRouter server on :17777 with the data fetched into data/.
set -euo pipefail
cd "$(dirname "$0")/data"
mkdir -p customprofiles
exec java -Xmx${BROUTER_XMX:-2g} -cp brouter-1.7.10/brouter-1.7.10-all.jar btools.server.RouteServer \
  segments brouter-1.7.10/profiles2 customprofiles 17777 ${BROUTER_THREADS:-4}
