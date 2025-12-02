FROM node:20-slim

WORKDIR /app

# System deps:
#  - fonts-dejavu-core so we have a decent default font
#  - libs needed for node-canvas
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-dejavu-core \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
 && rm -rf /var/lib/apt/lists/*

# Install JS deps
COPY package*.json ./
RUN npm install --omit=dev

# App code
COPY server.js .

# Default env values – override in Unraid template
ENV HA_URL=http://homeassistant:8123
ENV HA_TOKEN=changeme
ENV WEATHER_ENTITY=weather.ironynet
ENV DL_ENTITY=sensor.transmission_download_speed
ENV UL_ENTITY=sensor.transmission_upload_speed
ENV INSIDE_TEMP_ENTITY=
ENV INSIDE_HUMIDITY_ENTITY=
ENV HOTTUB_TEMP_ENTITY=
ENV BIND_HOST=0.0.0.0
ENV BIND_PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
