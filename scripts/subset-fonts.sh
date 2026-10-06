#!/bin/sh
# Subset Iosevka (from @fontsource/iosevka) to Latin + the few symbols the site uses.
# woff2 for the page text, woff for bouffont itself (opentype.js can't read woff2).
set -e
SRC=node_modules/@fontsource/iosevka/files
OUT=demo/fonts
U="U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201D,U+2026,U+2190-2193,U+2715,U+27F3"
for f in 400-normal 700-normal 400-italic; do
  pyftsubset "$SRC/iosevka-latin-$f.woff" --unicodes="$U" --flavor=woff2 --output-file="$OUT/iosevka-$f.woff2"
done
pyftsubset "$SRC/iosevka-latin-400-normal.woff" --unicodes="$U" --flavor=woff --output-file="$OUT/iosevka-400-normal.woff"
