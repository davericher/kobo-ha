FROM node:25

WORKDIR /app

# Fonts so we can draw nice text/icons
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY app.js .

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

CMD ["node", "app.js"]
