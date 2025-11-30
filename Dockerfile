FROM python:3.12-slim

WORKDIR /app

# Fonts so we can draw nice text/icons
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Default env values – override in Unraid template
ENV HA_URL=http://homeassistant:8123
ENV HA_TOKEN=changeme
ENV WEATHER_ENTITY=weather.ironynet
ENV DL_ENTITY=sensor.transmission_download_speed
ENV UL_ENTITY=sensor.transmission_upload_speed
ENV BIND_HOST=0.0.0.0
ENV BIND_PORT=8080

EXPOSE 8080

CMD ["python", "app.py"]
