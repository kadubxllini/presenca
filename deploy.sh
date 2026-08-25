#!/bin/bash
set -e

echo "=== Presença: iniciando deploy ==="

# 1. Atualizar repositório
echo "1/4 Atualizando repositório..."
if [ -d ".git" ]; then
  git pull
fi

# 2. Instalar dependências
echo "2/4 Instalando dependências..."
npm install --omit=dev

# 3. Gerenciar processo no PM2
echo "3/4 Configurando PM2..."
if pm2 describe presenca >/dev/null 2>&1; then
  PORT="${PORT:-3003}" NODE_ENV=production pm2 restart presenca --update-env
else
  PORT="${PORT:-3003}" NODE_ENV=production pm2 start server.js --name presenca --update-env
fi

# 4. Salvar estado do PM2
echo "4/4 Salvando estado do PM2..."
pm2 save

echo ""
echo "=== Deploy do Presença concluído com sucesso na porta 3003! ==="
pm2 list
