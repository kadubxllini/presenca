# Guia de Deploy - Presença na VPS

**Domínio**: `https://presenca.clasure.com.br`  
**Aplicação**: Controle de Presença e Faltas (PWA + SQLite + Node.js)  
**Porta na VPS**: `3003`

---

## 1. Configuração do DNS
No seu painel DNS (Cloudflare, Registro.br, etc.):
- Adicione um registro do tipo **A**:
  - **Tipo**: `A`
  - **Nome/Host**: `presenca`
  - **Destino/IP**: `163.176.217.54`
  - **TTL**: Automático ou 300s

---

## 2. Estrutura na VPS

- Diretório do projeto: `/home/opc/apps/presenca`
- Processo PM2: `presenca`
- Arquivo Nginx: `/etc/nginx/conf.d/presenca.clasure.conf`

---

## 3. Comandos Úteis na VPS

### Acessar a VPS via SSH:
```bash
ssh -i ~/.ssh/ssh-vps-ficar-rico.key opc@163.176.217.54
```

### Atualizar a Aplicação:
```bash
cd /home/opc/apps/presenca
./deploy.sh
```

### Gerenciar PM2:
```bash
pm2 status
pm2 logs presenca
pm2 restart presenca
```

### Ativar Certificado SSL (HTTPS):
Assim que o DNS estiver apontado, execute:
```bash
sudo /usr/local/bin/certbot --nginx -d presenca.clasure.com.br
```
E recarregue o Nginx:
```bash
sudo nginx -t && sudo systemctl reload nginx
```
