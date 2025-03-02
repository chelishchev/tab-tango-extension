#!/bin/bash -ex
V=$(cat ./manifest.json | jq -Mr .version)
rm -f "./builds/tab-tango-$V.zip"
zip -r -FS "./builds/tab-tango-$V.zip" ./assets/ ./background_script.js ./manifest.json ./options.html ./options_script.js -x '*.DS_Store' -x '*Thumbs.db'