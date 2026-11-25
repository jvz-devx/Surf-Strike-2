#!/usr/bin/env bash
# Build the script-built first-person guns into apps/web/static/models/weapons/.
# Needs Blender and Node (npx fetches the glTF Transform CLI). README.md has the guide.
#
#   tools/models/procedural/build.sh                       every script-built gun
#   tools/models/procedural/build.sh striker [pistol ...]  just those
#   tools/models/procedural/build.sh striker --renders <dir>   and neutral Blender renders in <dir>/<id>/
#
# A gun is the .py file in this folder with the line `ID = '<id>'` (the weapon id).
# Blender runs it headless; it builds, bakes and exports <id>-fp.glb in asset space
# and prints its budget, triangles, length and fit data. glTF Transform then does
# what tools/models/build.sh does to the generated guns (meshopt compression, WebP
# textures), without simplifying: the mesh is already at its budget. A gun over its
# triangle or byte budget fails the build.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
blender="${BLENDER:-$(command -v blender || echo /Applications/Blender.app/Contents/MacOS/Blender)}"
out="$root/apps/web/static/models/weapons"
renders=""
ids=()
while [ $# -gt 0 ]; do
	case "$1" in
		--renders) renders="$(mkdir -p "$2" && cd "$2" && pwd)"; shift 2 ;;
		*) ids+=("$1"); shift ;;
	esac
done
if [ ${#ids[@]} -eq 0 ]; then
	for f in "$here"/*.py; do
		id="$(sed -n "s/^ID = '\(.*\)'$/\1/p" "$f")"
		[ -n "$id" ] && ids+=("$id")
	done
fi
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"
for id in "${ids[@]}"; do
	script="$(grep -l "^ID = '$id'$" "$here"/*.py | head -1 || true)"
	if [ -z "$script" ]; then
		echo "no script in $here has ID = '$id'" >&2
		exit 1
	fi
	start=$(date +%s)
	echo "== $id ($(basename "$script"))"
	if ! "$blender" -b --factory-startup --python-exit-code 1 -P "$script" -- "$tmp/$id-fp.glb" ${renders:+renders=$renders/$id} > "$tmp/$id.log" 2>&1; then
		tail -n 40 "$tmp/$id.log" >&2
		exit 1
	fi
	grep -E '^(BUDGET|SLIVERS|TRIS|PIECES|BAKE|LENGTH|FIT|NODES|WARNING|EXPORT|RENDER)' "$tmp/$id.log" || true
	# BUDGET <tier> <triangles> tris <bytes> bytes <texture size> px
	read -r _ tier _ _ bytes _ < <(grep '^BUDGET' "$tmp/$id.log")
	# WebP at the highest quality that fits the byte budget: base colour, normal, roughness/metalness. The scene graph
	# stays as it is (no flatten, join or prune): the moving pieces and the points are nodes.
	gt="npx -y @gltf-transform/cli@4.5.1"
	for quality in "80 80 80" "76 80 70" "72 78 64" "68 75 60"; do
		read -r qc qn qm <<< "$quality"
		$gt webp "$tmp/$id-fp.glb" "$tmp/$id-1.glb" --effort 100 --quality "$qc" --slots baseColorTexture > /dev/null
		$gt webp "$tmp/$id-1.glb" "$tmp/$id-2.glb" --effort 100 --quality "$qn" --slots normalTexture > /dev/null
		$gt webp "$tmp/$id-2.glb" "$tmp/$id-3.glb" --effort 100 --quality "$qm" --slots metallicRoughnessTexture > /dev/null
		$gt optimize "$tmp/$id-3.glb" "$out/$id-fp.glb" --compress meshopt --texture-compress false \
			--simplify false --palette false --flatten false --join false --instance false --prune false > /dev/null
		size=$(wc -c < "$out/$id-fp.glb" | tr -d ' ')
		echo "WEBP $quality: $size bytes"
		[ "$size" -le "$bytes" ] && break
	done
	# The moving pieces and the points must survive the compression: every node the script named, with its name.
	node -e '
		const b = require("node:fs").readFileSync(process.argv[1]);
		const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)));
		const have = new Set(json.nodes.map((n) => n.name));
		const lost = process.argv.slice(2).filter((n) => !have.has(n));
		if (lost.length) { console.error("nodes lost in compression: " + lost.join(" ")); process.exit(1); }
	' "$out/$id-fp.glb" $(sed -n 's/^NODES//p' "$tmp/$id.log")
	echo "$out/$id-fp.glb: $size of $bytes bytes ($tier), built in $(( $(date +%s) - start )) s"
	if [ "$size" -gt "$bytes" ]; then
		echo "$id is over its $tier byte budget" >&2
		exit 1
	fi
done
