#!/bin/bash
# Mobile captures: Chrome windows can't go below ~500px, so each route opens inside a fixed-width
# iframe (mobile-wrapper.html). Serve the wrapper first: `python3 -m http.server 3200` in this folder.
# usage: BASE=http://localhost:3000 mobcap.sh /route=CAPTUREID [/other=CAPTUREID …]
# env: BASE (app origin, required), WRAPPER (default http://localhost:3200), WIDTH (390),
#      DELAY (capture delay ms, 4000), GAP (seconds between routes, 20)
: "${BASE:?set BASE to the app origin, e.g. http://localhost:3000}"
WRAPPER=${WRAPPER:-http://localhost:3200}
for pair in "$@"; do
  p="${pair%%=*}"; id="${pair#*=}"
  ep="https%3A%2F%2Fmcp.figma.com%2Fmcp%2Fcapture%2F${id}%2Fsubmit%3FbindVariables%3Dtrue"
  inner="${BASE}${p}#figmacapture=${id}&figmaendpoint=${ep}&figmadelay=${DELAY:-4000}"
  enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$inner")
  open "${WRAPPER}/mobile-wrapper.html?w=${WIDTH:-390}#${enc}"
  sleep "${GAP:-20}"
done
