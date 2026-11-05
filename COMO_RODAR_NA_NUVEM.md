# 🚀 Como Deixar o LinkPronto Rodando na Nuvem 24h (Sem Precisar do PC Ligado)

O projeto **Mossoró Ofertas — LinkPronto** já está 100% integrado ao **Supabase** (Banco de dados PostgreSQL oficial na nuvem em São Paulo) e pronto para ser hospedado gratuitamente na nuvem!

---

## 🛠️ O que foi configurado:
1. **Banco de Dados Supabase (São Paulo / sa-east-1):**
   - Fila de produtos (`linkpronto_queue`)
   - Histórico de postagens (`linkpronto_history`)
   - Configurações e horários de início e término (`linkpronto_settings`)
   - Backup automático da sessão do WhatsApp (`linkpronto_whatsapp_auth`)
2. **Janela de Horário Programado:**
   - Disparos só acontecem entre o horário de início (ex: **08:00**) e o horário de fim (ex: **22:00**).
   - Fora desse horário, o sistema dorme automaticamente e acorda no dia seguinte.
3. **Multi-plataforma:**
   - Funciona no seu computador localmente ou em qualquer servidor de nuvem gratuito.

---

## 🌐 Opção 1: Hospedar Gratuitamente no Render.com (Recomendado)

O **Render.com** oferece hospedagem gratuita para aplicações Node.js e conecta direto com seu GitHub.

### Passo 1: Subir seu projeto para o GitHub
Se você ainda não colocou o projeto no GitHub:
1. Acesse [github.com](https://github.com) e crie um repositório chamado `mossoro-ofertas` (pode ser Privado ou Público).
2. Na pasta do seu projeto no computador, abra o terminal e rode:
   ```bash
   git init
   git add .
   git commit -m "LinkPronto v2 com Supabase e Piloto Automatico"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/mossoro-ofertas.git
   git push -u origin main
   ```

### Passo 2: Criar o Web Service no Render
1. Acesse [render.com](https://render.com) e faça login com seu GitHub.
2. Clique no botão **New +** > **Web Service**.
3. Selecione o repositório `mossoro-ofertas`.
4. Preencha as configurações:
   - **Name:** `mossoro-ofertas`
   - **Region:** `Oregon (US West)` ou a mais próxima.
   - **Runtime:** `Node`
   - **Build Command:** `npm install --omit=dev`
   - **Start Command:** `node server.js`
   - **Instance Type:** `Free`
5. Na seção **Environment Variables** (Variáveis de Ambiente), adicione:
   - `PORT` = `10000`
   - `HOST` = `0.0.0.0`
   - `SUPABASE_URL` = `https://bnjrbvlnyvyudotngtrb.supabase.co`
   - `SUPABASE_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJuanJidmxueXZ5dWRvdG5ndHJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1ODI0MjksImV4cCI6MjEwOTE1ODQyOX0.TanRo-ioNOtipU3oJE5YU-zPmhfA-QABjuWvqXP5aNQ`
6. Clique em **Deploy Web Service**.

---

## 💡 Dica de Ouro: Como manter o Render acordado 24/7 sem dormir (Gratuito)

No plano gratuito, o Render adormece se ficar 15 minutos sem visitas. Para que ele **nunca adormeça** e continue disparando as ofertas mesmo de madrugada:

1. Acesse o site gratuito [UptimeRobot.com](https://uptimerobot.com) ou [Cron-job.org](https://cron-job.org).
2. Crie um monitor gratuito do tipo **HTTP(s)**.
3. Cole a URL pública do seu Render (ex: `https://mossoro-ofertas.onrender.com/api/queue/status`).
4. Defina o intervalo de verificação para **a cada 5 ou 10 minutos**.
5. Pronto! O UptimeRobot enviará uma requisição leve a cada 5 minutos, mantendo seu servidor 100% ativo 24h por dia, sem gastar nada!

---

## 📱 Como usar depois de hospedado:

1. Abra a URL do seu Render no celular ou no computador (ex: `https://mossoro-ofertas.onrender.com`).
2. Vá na aba **WhatsApp & Canais** e escaneie o QR Code uma única vez com seu celular.
3. Adicione as 10 ou 20 ofertas que quiser à fila.
4. Ajuste o horário de disparo (ex: das 08:00 às 22:00) e o intervalo (ex: a cada 5 min).
5. Clique em **▶️ Iniciar Piloto Automático**.
6. **Pode desligar seu computador!** O servidor na nuvem cuidará de todos os envios no horário programado.
