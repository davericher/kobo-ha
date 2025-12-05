FROM node:25

WORKDIR /app

# Fonts so we can draw nice text/icons
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-dejavu-core \
    fonts-freefont-ttf \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

# Copy deps and install first (better cache)
COPY package*.json ./
RUN npm install --omit=dev

# Copy *everything* from src (files + subdirs) into /app
COPY src/ ./

ENV BIND_HOST=0.0.0.0
ENV BIND_PORT=8080

EXPOSE 8080

CMD ["node", "app.js"]
