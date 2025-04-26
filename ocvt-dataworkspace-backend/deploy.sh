#!/bin/bash
SERVER="hope@emes.bj"
REMOTE_DIR="/home/hope/ocvt-dataworkspace-backend"

rsync -avz --progress . $SERVER:$REMOTE_DIR

ssh $SERVER << 'EOF'
  cd /home/hope/ocvt-dataworkspace-backend
  docker-compose down
  docker-compose up --build -d
EOF
