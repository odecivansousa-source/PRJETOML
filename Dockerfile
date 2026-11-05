# Imagem oficial Node.js LTS
FROM node:20-slim

# Instala dependências do sistema para sharp e canvas se necessário
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia manifestos de dependências
COPY package*.json ./

# Instala todas as dependências
RUN npm install --omit=dev

# Copia o restante do código da aplicação
COPY . .

# Cria pasta de autenticação do WhatsApp com permissão adequada
RUN mkdir -p .linkpronto-whatsapp-auth

# Expõe a porta padrão
EXPOSE 4174

# Define variáveis de ambiente padrão
ENV PORT=4174
ENV HOST=0.0.0.0
ENV NODE_ENV=production

# Comando para iniciar o servidor
CMD ["node", "server.js"]
