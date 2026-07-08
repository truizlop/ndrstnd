#!/usr/bin/env bash
# Edits the recorded segments (demo/out/*.webm) into the landing-page demo videos:
#   site/media/demo-codex.mp4 / demo-claude.mp4 (+ poster JPGs).
# Segment order per agent: <agent>-frame → artifact-<agent> → endcard, joined with
# a white flash (opening the artifact) and a plain crossfade into the end card.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p ../site/media

TRIM=0.35 # drop the blank first frames Playwright records during page load
XF=0.5

dur() { ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$1"; }
calc() { awk "BEGIN { printf \"%.3f\", $1 }"; }

build() {
  local agent=$1
  local frame="out/${agent}-frame.webm" artifact="out/artifact-${agent}.webm" end="out/endcard.webm"
  # Codex ends with the artifact already open in the app's embedded browser, so a plain
  # crossfade reads as expanding that pane; Claude opens a browser, hence the white flash.
  local t1="fadewhite"
  [ "$agent" = "codex" ] && t1="fade"
  local d0 d1 off1 off2
  d0=$(calc "$(dur "$frame") - $TRIM")
  d1=$(calc "$(dur "$artifact") - $TRIM")
  off1=$(calc "$d0 - $XF")
  off2=$(calc "$d0 + $d1 - 2 * $XF")

  ffmpeg -y -v error -i "$frame" -i "$artifact" -i "$end" -filter_complex "
    [0:v]trim=start=$TRIM,setpts=PTS-STARTPTS,fps=30,format=yuv420p[v0];
    [1:v]trim=start=$TRIM,setpts=PTS-STARTPTS,fps=30,format=yuv420p[v1];
    [2:v]trim=start=$TRIM,setpts=PTS-STARTPTS,fps=30,format=yuv420p[v2];
    [v0][v1]xfade=transition=$t1:duration=$XF:offset=$off1[v01];
    [v01][v2]xfade=transition=fade:duration=$XF:offset=$off2[v]
  " -map "[v]" -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -movflags +faststart \
    "../site/media/demo-${agent}.mp4"

  ffmpeg -y -v error -ss 2 -i "../site/media/demo-${agent}.mp4" -frames:v 1 -q:v 3 \
    "../site/media/demo-${agent}-poster.jpg"
  printf '%s: %ss, %s\n' "demo-${agent}.mp4" "$(dur "../site/media/demo-${agent}.mp4")" \
    "$(du -h "../site/media/demo-${agent}.mp4" | cut -f1)"
}

build codex
build claude
