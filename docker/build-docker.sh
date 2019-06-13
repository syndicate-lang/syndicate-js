#!/bin/sh
set -xe

rm -rf built-packages
mkdir built-packages
(cd built-packages && npm pack -q $(
         for p in \
             core \
             driver-browser-ui \
             driver-http-node \
             driver-mdns \
             driver-streams-node \
             driver-timer \
             driver-udp-node \
             driver-websocket \
             server \
             syntax-playground
         do
             echo ../../packages/$p
         done))

docker build -t syndicate-js "$(dirname "$0")"
