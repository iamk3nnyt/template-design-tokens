#!/bin/zsh
# Opens one route with Figma's html-to-design capture parameters (desktop width = your browser window).
# usage: open.sh <base-url> <path> <captureId> [delayMs]
# Open ONE tab at a time: background tabs are throttled and never submit.
base=$1; p=$2; id=$3; d=${4:-3000}
[[ -z $base || -z $p || -z $id ]] && { echo "usage: open.sh <base-url> <path> <captureId> [delayMs]"; exit 2; }
ep="https%3A%2F%2Fmcp.figma.com%2Fmcp%2Fcapture%2F${id}%2Fsubmit%3FbindVariables%3Dtrue"
open "${base}${p}#figmacapture=${id}&figmaendpoint=${ep}&figmadelay=${d}"
