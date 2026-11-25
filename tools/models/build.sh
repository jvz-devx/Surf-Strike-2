#!/usr/bin/env bash
# Rebuild the shipped weapon models (apps/web/static/models/weapons/) from the raw
# image-to-3D files. Needs Blender and Node (npx fetches the glTF Transform CLI).
#
#   tools/models/build.sh <raw dir> [id ...]
#
# <raw dir> holds the raw file of every id in tools/models/manifest.json (its "src",
# or <id>.glb). Per id:
#  1. prep.py (Blender, headless): canonical frame, cut boxes, markings blurred,
#     texture sizes; the first-person file.
#  2. glTF Transform: weld, simplify, meshopt compression, WebP textures.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
raw="${1:?raw dir}"
shift
blender="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
out="$root/apps/web/static/models/weapons"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"
ids=("$@")
if [ ${#ids[@]} -eq 0 ]; then
	ids=($(node -e "console.log(Object.keys(require('$here/manifest.json').models).join(' '))"))
fi
gt="npx -y @gltf-transform/cli@4.5.1"
src() { node -e "console.log(require('$here/manifest.json').models['$1'].src||'$1.glb')"; }
setting() { node -e "const m=require('$here/manifest.json');const s={...m['$2'],...(m.models['$1']['$2']||{})};console.log(s['$3'])"; }
for id in "${ids[@]}"; do
	"$blender" -b --factory-startup -P "$here/prep.py" -- "$raw/$(src "$id")" "$id" "$here/manifest.json" "$tmp/$id-fp.glb" | grep -E '^(ALIGN|CUT|TUBE|BOUNDS)' || true
	$gt optimize "$tmp/$id-fp.glb" "$out/$id-fp.glb" --compress meshopt --texture-compress webp --texture-size "$(setting "$id" fp base)" \
		--simplify-ratio "$(setting "$id" fp simplify)" --simplify-error "$(setting "$id" fp error)" --palette false > /dev/null
	ls -l "$out/$id-fp.glb" | awk '{print $5, $9}'
done
