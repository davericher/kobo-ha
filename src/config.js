// config.js
// Central place for env vars and static config

// Home Assistant base + token
export const HA_URL = (process.env.HA_URL || "http://homeassistant:8123").replace(
    /\/+$/,
    ""
);
export const HA_TOKEN = process.env.HA_TOKEN || "";

// Common HA headers
export const HA_HEADERS = {
    ...(HA_TOKEN ? {Authorization: `Bearer ${HA_TOKEN}`} : {}),
    "Content-Type": "application/json",
};

// Entity IDs (override via env if needed)
export const WEATHER_ENTITY = process.env.WEATHER_ENTITY || "weather.provider";
export const DL_ENTITY =
    process.env.DL_ENTITY || "sensor.transmission_download_speed";
export const UL_ENTITY =
    process.env.UL_ENTITY || "sensor.transmission_upload_speed";

// Inside sensors
export const INSIDE_TEMP_ENTITY = process.env.INSIDE_TEMP_ENTITY || "";
export const INSIDE_HUMIDITY_ENTITY = process.env.INSIDE_HUMIDITY_ENTITY || "";
export const HOTTUB_TEMP_ENTITY = process.env.HOTTUB_TEMP_ENTITY || "";

// Location / counts
export const LIGHTS_ON_ENTITY = process.env.LIGHTS_ON_ENTITY || "";
export const FANS_ON_ENTITY = process.env.FANS_ON_ENTITY || "";
export const TORRENTS_ENTITY =
    process.env.TORRENTS_ENTITY || "sensor.transmission_total_torrents";
export const PERSON_DAVE_ENTITY = process.env.PERSON_DAVE_ENTITY || "person.dave";
export const PERSON_KAYLA_ENTITY =
    process.env.PERSON_KAYLA_ENTITY || "person.kayla";

// Appliances (washer/dryer are binary_sensor.* with on/off, range is sensor.* with "running")
export const WASHER_POWER_ENTITY =
    process.env.WASHER_POWER_ENTITY || "binary_sensor.washer_power";
export const DRYER_POWER_ENTITY =
    process.env.DRYER_POWER_ENTITY || "binary_sensor.dryer_power";
export const RANGE_STATE_ENTITY =
    process.env.RANGE_STATE_ENTITY || "sensor.range_operating_state";
// (Printer slot reserved for later)

// Canvas + Skia
export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 600;
export const SKIA_USE_GPU = /^1|true|yes$/i.test(process.env.SKIA_GPU || "");

// HTTP binding
export const BIND_HOST = process.env.BIND_HOST || "0.0.0.0";
export const BIND_PORT = parseInt(process.env.BIND_PORT || "8080", 10);
