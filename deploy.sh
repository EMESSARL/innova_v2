#!/bin/bash

SERVER="jennifer@emes.bj"
REMOTE_DIR="/home/jennifer/ocvt-backend-validation"

echo "Transfert des fichiers vers le serveur..."
rsync -avz --progress . $SERVER:$REMOTE_DIR

echo "Connexion au serveur et redémarrage des services Docker..."
ssh $SERVER << 'EOF'
  cd /home/jennifer/ocvt-backend-validation
  docker-compose down
  docker-compose up --build -d
EOF

echo "Déploiement terminé avec succès !"
