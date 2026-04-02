#!/bin/bash
cd "$(dirname "$0")"
pkill -f "node src/server/index.js" 2>/dev/null
sleep 1
node src/server/index.js < /dev/null > /tmp/scan.log 2>&1 &
echo $! > /tmp/scan.pid
echo "SCAN started (PID: $(cat /tmp/scan.pid))"
echo "Log: /tmp/scan.log"
