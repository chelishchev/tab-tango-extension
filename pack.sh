#!/bin/bash -ex
V=$(cat ./manifest.json | jq -Mr .version)
rm -f "./builds/duplicate-tab-$V.zip"
zip -r -FS "./builds/duplicate-tab-$V.zip" ./assets/ ./background_script.js ./manifest.json ./options.html ./options_script.js -x '*.DS_Store' -x '*Thumbs.db'