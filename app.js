#!/usr/bin/env node
// app.js
// Kobo dashboard server using skia-canvas, with RAW + PNG outputs
// Now with Home Assistant WebSocket live cache.

import http from "node:http";
import { Canvas, loadImage } from "skia-canvas";
import WebSocket from "ws";

// ===== Config via environment variables =====
const HA_URL = (process.env.HA_URL || "http://homeassistant:8123").replace(
  /\/+$/,
  ""
);
const HA_TOKEN = process.env.HA_TOKEN || "";

const WEATHER_ENTITY = process.env.WEATHER_ENTITY || "weather.provider";
const DL_ENTITY =
  process.env.DL_ENTITY || "sensor.transmission_download_speed";
const UL_ENTITY =
  process.env.UL_ENTITY || "sensor.transmission_upload_speed";

// Inside sensors
const INSIDE_TEMP_ENTITY = process.env.INSIDE_TEMP_ENTITY || "";
const INSIDE_HUMIDITY_ENTITY = process.env.INSIDE_HUMIDITY_ENTITY || "";
const HOTTUB_TEMP_ENTITY = process.env.HOTTUB_TEMP_ENTITY || "";

// New “location” / counts
const LIGHTS_ON_ENTITY = process.env.LIGHTS_ON_ENTITY || "";
const FANS_ON_ENTITY = process.env.FANS_ON_ENTITY || "";
const TORRENTS_ENTITY =
  process.env.TORRENTS_ENTITY || "sensor.transmission_total_torrents";

const PERSON_DAVE_ENTITY = process.env.PERSON_DAVE_ENTITY || "person.dave";
const PERSON_KAYLA_ENTITY = process.env.PERSON_KAYLA_ENTITY || "person.kayla";

// Bind Host/Port
const BIND_HOST = process.env.BIND_HOST || "0.0.0.0";
const BIND_PORT = parseInt(process.env.BIND_PORT || "8080", 10);

// Logical canvas in LANDSCAPE. We’ll rotate it at the end to 600x800 portrait.
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

// Optional GPU toggle for skia-canvas
const SKIA_USE_GPU = /^1|true|yes$/i.test(process.env.SKIA_GPU || "");

// REST headers for HA
const HA_HEADERS = {
  ...(HA_TOKEN ? { Authorization: `Bearer ${HA_TOKEN}` } : {}),
  "Content-Type": "application/json",
};

// ===== Home Assistant WebSocket live cache =====

const stateCache = new Map(); // entity_id -> { state, attributes }
let cacheReady = false;

let ws = null;
let wsConnected = false;
let wsAuthOk = false;
let wsIdCounter = 1;
let wsReconnectTimer = null;

// Build ws:// or wss:// URL from HA_URL
const HA_WS_URL = (() => {
  try {
    const url = new URL(HA_URL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/api/websocket";
    url.search = "";
    return url.toString();
  } catch {
    return HA_URL.replace(/^http/, "ws") + "/api/websocket";
  }
})();

function setCacheFromStatesArray(arr) {
  stateCache.clear();
  for (const s of arr || []) {
    if (!s || !s.entity_id) continue;
    stateCache.set(s.entity_id, {
      state: s.state,
      attributes: s.attributes || {},
    });
  }
  if (stateCache.size > 0) {
    cacheReady = true;
  }
}

async function seedStatesFromRest() {
  try {
    const res = await fetch(`${HA_URL}/api/states`, { headers: HA_HEADERS });
    if (!res.ok) throw new Error(`HA /api/states HTTP ${res.status}`);
    const all = await res.json();
    setCacheFromStatesArray(all);
    console.log(
      `[kobo-dashboard] Seeded ${stateCache.size} HA states from REST`
    );
  } catch (e) {
    console.error("[kobo-dashboard] Error seeding HA state cache:", e.message);
  }
}

function sendWs(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function subscribeStateChanged() {
  const id = wsIdCounter++;
  sendWs({
    id,
    type: "subscribe_events",
    event_type: "state_changed",
  });
}

function scheduleReconnect() {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWebSocket();
  }, 5000);
}

function handleWsMessage(data) {
  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch {
    return;
  }

  if (msg.type === "auth_required") {
    // reply with auth
    sendWs({ type: "auth", access_token: HA_TOKEN });
    return;
  }

  if (msg.type === "auth_ok") {
    wsAuthOk = true;
    console.log("[kobo-dashboard] HA websocket auth_ok");
    // Seed initial state snapshot via REST, then subscribe to changes
    seedStatesFromRest().then(() => {
      subscribeStateChanged();
    });
    return;
  }

  if (msg.type === "auth_invalid") {
    wsAuthOk = false;
    console.error(
      "[kobo-dashboard] HA websocket auth_invalid:",
      msg.message || ""
    );
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    return;
  }

  if (msg.type === "event" && msg.event?.event_type === "state_changed") {
    const newState = msg.event.data?.new_state;
    if (newState && newState.entity_id) {
      stateCache.set(newState.entity_id, {
        state: newState.state,
        attributes: newState.attributes || {},
      });
      cacheReady = true;
    }
    return;
  }

  // We don't care about "result" or other events here.
}

function connectWebSocket() {
  if (!HA_TOKEN) {
    console.warn(
      "[kobo-dashboard] HA_TOKEN not set; WebSocket live cache disabled (REST fallback only)."
    );
    return;
  }

  try {
    console.log("[kobo-dashboard] Connecting to HA websocket:", HA_WS_URL);
    ws = new WebSocket(HA_WS_URL);

    ws.on("open", () => {
      wsConnected = true;
      wsAuthOk = false;
      console.log("[kobo-dashboard] HA websocket open");
    });

    ws.on("message", handleWsMessage);

    ws.on("close", (code, reason) => {
      wsConnected = false;
      wsAuthOk = false;
      console.warn(
        `[kobo-dashboard] HA websocket closed (${code}): ${
          reason?.toString() || ""
        }`
      );
      scheduleReconnect();
    });

    ws.on("error", (err) => {
      console.error("[kobo-dashboard] HA websocket error:", err.message);
      // close event will schedule reconnect
    });
  } catch (e) {
    console.error("[kobo-dashboard] Failed to create HA websocket:", e.message);
    scheduleReconnect();
  }
}

// Kick off websocket connection & one-time initial seed (in case ws is slow)
connectWebSocket();
seedStatesFromRest();

// Helper to read from cache
function haStateFromCache(entityId) {
  if (!entityId) return [null, {}];
  const entry = stateCache.get(entityId);
  if (!entry) return [null, {}];
  return [entry.state, entry.attributes || {}];
}

// ===== Helpers =====

function fontSpec(size) {
  return `${size}px "DejaVu Sans"`;
}

function textSize(ctx, text) {
  const t = text || "";
  const m = ctx.measureText(t);
  const w = m.width || 0;
  let h =
    (m.actualBoundingBoxAscent || m.emHeightAscent || 0) +
    (m.actualBoundingBoxDescent || m.emHeightDescent || 0);

  if (!h) {
    const match = /(\d+)px/.exec(ctx.font);
    h = match ? parseInt(match[1], 10) : 16;
  }
  return { w, h };
}

// Primary HA state accessor: prefer cache; REST as cold-start fallback
async function haState(entityId) {
  if (!entityId) return [null, {}];

  if (cacheReady) {
    return haStateFromCache(entityId);
  }

  // Cold-start / fallback
  const url = `${HA_URL}/api/states/${entityId}`;
  const res = await fetch(url, { headers: HA_HEADERS });
  if (!res.ok) throw new Error(`HA ${entityId} HTTP ${res.status}`);
  const data = await res.json();
  return [data.state, data.attributes || {}];
}

function iconForCondition(condition) {
  const c = (condition || "").toLowerCase();
  const mapping = {
    sunny: "☀",
    clear: "☀",
    "clear-night": "☾",
    cloudy: "☁",
    partlycloudy: "⛅",
    "partly cloudy": "⛅",
    rainy: "☂",
    pouring: "☔",
    snowy: "❄",
    "snowy-rainy": "❄☂",
    hail: "☄",
    lightning: "⚡",
    "lightning-rainy": "⛈",
    windy: "🌀",
    fog: "〰",
    "windy-variant": "🌀☁",
    exceptional: "!",
  };
  for (const [key, icon] of Object.entries(mapping)) {
    if (c.startsWith(key)) return icon;
  }
  return "·";
}

function formatSpeed(state, attrs) {
  if (state === "unknown" || state === "unavailable" || state == null) return "-";
  const unit = attrs?.unit_of_measurement || "";
  const n = parseFloat(state);
  if (!Number.isNaN(n)) return `${n.toFixed(1)} ${unit}`.trim();
  return `${state} ${unit}`.trim();
}

function fitTextInBox(ctx, text, box, maxSize, minSize) {
  const [left, top, right, bottom] = box;
  const boxW = Math.max(1, right - left);
  const boxH = Math.max(1, bottom - top);

  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.save();
    ctx.font = fontSpec(size);
    const { w, h } = textSize(ctx, text);
    ctx.restore();
    if (w <= boxW && h <= boxH) {
      return { font: fontSpec(size), w, h };
    }
  }

  ctx.save();
  ctx.font = fontSpec(minSize);
  const { w, h } = textSize(ctx, text);
  ctx.restore();
  return { font: fontSpec(minSize), w, h };
}

async function numericState(entityId) {
  if (!entityId) return [null, null, {}];
  try {
    const [state, attrs] = await haState(entityId);
    if (state === "unknown" || state === "unavailable" || state == null) {
      return [null, attrs.unit_of_measurement, attrs];
    }
    const v = parseFloat(state);
    if (Number.isNaN(v)) return [null, attrs.unit_of_measurement, attrs];
    return [v, attrs.unit_of_measurement, attrs];
  } catch {
    return [null, null, {}];
  }
}

async function stringState(entityId) {
  if (!entityId) return [null, {}];
  try {
    const [state, attrs] = await haState(entityId);
    if (state === "unknown" || state === "unavailable" || state == null) {
      return [null, attrs];
    }
    return [String(state), attrs];
  } catch {
    return [null, {}];
  }
}

function titleCase(str) {
  return String(str || "")
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(" ");
}

function formatPersonLocation(state) {
  if (!state) return "—";
  if (state === "home") return "Home";
  if (state === "not_home") return "Away";
  return titleCase(state);
}

function ordinalSuffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (v % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

async function drawWeatherIcon(ctx, box, condition, wAttrs) {
  const [left, top, right, bottom] = box;
  const boxW = Math.max(1, right - left);
  const boxH = Math.max(1, bottom - top);

  // Try HA entity_picture first
  let iconUrl = wAttrs?.entity_picture;
  if (iconUrl && typeof iconUrl === "string") {
    if (iconUrl.startsWith("/")) iconUrl = `${HA_URL}${iconUrl}`;
    try {
      const img = await loadImage(iconUrl, { headers: HA_HEADERS });
      const iw = img.width || 1;
      const ih = img.height || 1;
      const scale = Math.min(boxW / iw, boxH / ih, 1);
      const drawW = Math.max(1, Math.floor(iw * scale));
      const drawH = Math.max(1, Math.floor(ih * scale));
      const dx = left + (boxW - drawW) / 2;
      const dy = top + (boxH - drawH) / 2;
      ctx.drawImage(img, dx, dy, drawW, drawH);
      return;
    } catch {
      // fall back to glyph
    }
  }

  // Fallback: glyph perfectly centered in box
  const glyph = iconForCondition(condition);
  const maxSize = Math.min(boxH - 10, 260);
  let chosenSize = 80;

  for (let size = maxSize; size >= 80; size -= 2) {
    ctx.save();
    ctx.font = fontSpec(size);
    const { w } = textSize(ctx, glyph);
    ctx.restore();
    if (w <= boxW - 10) {
      chosenSize = size;
      break;
    }
  }

  ctx.save();
  ctx.font = fontSpec(chosenSize);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, (left + right) / 2, (top + bottom) / 2);
  ctx.restore();
}

// Rotate landscape -> portrait (600x800), USB on the right
function rotateToPortrait(canvas) {
  const rotated = new Canvas(600, 800, { gpu: SKIA_USE_GPU });
  const rctx = rotated.getContext("2d");
  rctx.fillStyle = "#ffffff";
  rctx.fillRect(0, 0, rotated.width, rotated.height);

  rctx.setTransform(1, 0, 0, 1, 0, 0);
  rctx.translate(0, rotated.height);
  rctx.rotate(-Math.PI / 2);
  rctx.drawImage(canvas, 0, 0);
  return rotated;
}

// ===== Main LANDSCAPE renderer =====
async function buildLandscapeCanvas() {
  const canvas = new Canvas(CANVAS_WIDTH, CANVAS_HEIGHT, {
    gpu: SKIA_USE_GPU,
  });
  const ctx = canvas.getContext("2d");

  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.fillStyle = "#000000"; // darkest possible for text
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  const now = new Date();

  const COND_MAX_SIZE = 56;
  const DETAIL_MAX_SIZE = 28;
  const LABEL_MIN_SIZE = 14;
  const SMALL_SIZE = 18;
  const TIME_FONT_SIZE = 10;
  const HEADER_LABEL_SIZE = 20;

  const margin = 12;
  const contentLeft = margin;
  const contentRight = CANVAS_WIDTH - margin;
  const contentTop = margin;
  const contentBottom = CANVAS_HEIGHT - margin;

  // Major splits (4 quadrants like the sketch)
  const splitX = 420; // left/right
  const midY = CANVAS_HEIGHT / 2; // top/bottom

  const leftColWidth = splitX - contentLeft;
  const leftMidX = contentLeft + leftColWidth / 2;

  const bottomHeight = contentBottom - midY;
  const bottomMidY = midY + bottomHeight / 2;

  // ===== Fetch weather data (from cache / REST) =====
  let weatherState, wAttrs;
  try {
    [weatherState, wAttrs] = await haState(WEATHER_ENTITY);
  } catch (e) {
    ctx.font = fontSpec(DETAIL_MAX_SIZE);
    ctx.fillText("Error reading weather", margin, margin);
    ctx.font = fontSpec(SMALL_SIZE);
    ctx.fillText(String(e), margin, margin + DETAIL_MAX_SIZE + 4);
    return canvas;
  }

  const condition = weatherState;
  const temp = wAttrs.temperature;
  const tempUnit = wAttrs.temperature_unit || "°C";

  const humidityOut = wAttrs.humidity;
  const pressure = wAttrs.pressure;
  const cloudCoverage =
    wAttrs.cloud_coverage ?? wAttrs.cloudiness ?? wAttrs.clouds;
  const uvIndex = wAttrs.uv_index;

  const windSpeed = wAttrs.wind_speed ?? wAttrs.native_wind_speed;
  const windSpeedUnit =
    wAttrs.wind_speed_unit ?? wAttrs.native_wind_speed_unit ?? "m/s";
  const windBearing = wAttrs.wind_bearing;

  let windChillValue = null;
  for (const key of [
    "apparent_temperature",
    "wind_chill",
    "windchill",
    "feels_like",
    "apparent_temp",
  ]) {
    const v = wAttrs[key];
    if (v != null && v !== "unknown" && v !== "unavailable") {
      const n = parseFloat(v);
      if (!Number.isNaN(n)) {
        windChillValue = n;
        break;
      }
    }
  }

  // Transmission (download / upload)
  let dlText = "—";
  let ulText = "—";
  try {
    const [dlState, dlAttrs] = await haState(DL_ENTITY);
    const [ulState, ulAttrs] = await haState(UL_ENTITY);
    dlText = formatSpeed(dlState, dlAttrs);
    ulText = formatSpeed(ulState, ulAttrs);
  } catch {
    dlText = "ERR";
    ulText = "ERR";
  }

  // Inside sensors
  const [insideTempVal, insideTempUnit] = await numericState(
    INSIDE_TEMP_ENTITY
  );
  const [insideHumVal] = await numericState(INSIDE_HUMIDITY_ENTITY);
  const [hottubTempVal, hottubTempUnit] = await numericState(
    HOTTUB_TEMP_ENTITY
  );

  // Location / counts sensors
  const [lightsOnVal] = await numericState(LIGHTS_ON_ENTITY);
  const [fansOnVal] = await numericState(FANS_ON_ENTITY);
  const [torrentCount] = await numericState(TORRENTS_ENTITY);
  const [daveRaw] = await stringState(PERSON_DAVE_ENTITY);
  const [kaylaRaw] = await stringState(PERSON_KAYLA_ENTITY);

  const daveLoc = formatPersonLocation(daveRaw);
  const kaylaLoc = formatPersonLocation(kaylaRaw);
  const lightsText =
    lightsOnVal != null ? String(Math.round(lightsOnVal)) : "—";
  const fansText = fansOnVal != null ? String(Math.round(fansOnVal)) : "—";
  const torrentsText =
    torrentCount != null ? String(Math.round(torrentCount)) : "—";

  // ===== TOP-LEFT: Weather summary block =====
  const weatherLeft = contentLeft;
  const weatherTop = contentTop;
  const weatherRight = splitX;
  const weatherBottom = midY;

  // Condition line ("Cloudy")
  const condBox = [
    weatherLeft + 6,
    weatherTop + 4,
    weatherRight - 6,
    weatherTop + 60,
  ];
  const condText =
    (condition || "").charAt(0).toUpperCase() + (condition || "").slice(1);
  {
    const { font, w, h } = fitTextInBox(
      ctx,
      condText,
      condBox,
      COND_MAX_SIZE,
      LABEL_MIN_SIZE
    );
    ctx.font = font;
    const cx = (condBox[0] + condBox[2]) / 2;
    const cy = (condBox[1] + condBox[3]) / 2;
    ctx.fillText(condText, cx - w / 2, cy - h / 2);
  }

  // Detail rows (Humidity, Pressure, Wind, Clouds, UV, Transmission)
  const detailStartY = condBox[3] + 6;
  const detailBottom = weatherBottom - 6;
  const detailRowsCount = 6;
  const detailRowHeight = (detailBottom - detailStartY) / detailRowsCount;

  const detailTexts = (() => {
    const humStr = humidityOut != null ? `${humidityOut}%` : "\u2014"; // —
    const presStr = pressure != null ? `${pressure} hPa` : "\u2014";
    let windStr = "—";
    if (windSpeed != null) {
      const n = parseFloat(windSpeed);
      const speed = !Number.isNaN(n)
        ? `${n.toFixed(1)} ${windSpeedUnit}`
        : `${windSpeed} ${windSpeedUnit}`;
      const bearing = windBearing ? ` ${windBearing}` : "";
      windStr = `${speed}${bearing}`.trim();
    }
    const cloudStr = cloudCoverage != null ? `${cloudCoverage}%` : "\u2014";
    const uvStr = uvIndex != null ? String(uvIndex) : "\u2014";
    const txStr = `Up: ${ulText}   Down: ${dlText}`;
    return [
      `Humidity: ${humStr}`,
      `Pressure: ${presStr}`,
      `Wind: ${windStr}`,
      `Clouds: ${cloudStr}`,
      `UV Index: ${uvStr}`,
      `Transmission: ${txStr}`,
    ];
  })();

  const detailRowBounds = [];

  for (let i = 0; i < detailRowsCount; i++) {
    const rowTop = detailStartY + i * detailRowHeight;
    const rowBottom =
      i === detailRowsCount - 1 ? detailBottom : rowTop + detailRowHeight;
    detailRowBounds.push({ top: rowTop, bottom: rowBottom });

    const box = [weatherLeft + 8, rowTop + 2, weatherRight - 8, rowBottom - 2];
    const text = detailTexts[i] || "";
    const { font, w, h } = fitTextInBox(
      ctx,
      text,
      box,
      DETAIL_MAX_SIZE,
      LABEL_MIN_SIZE
    );
    ctx.font = font;
    const y = rowTop + (rowBottom - rowTop - h) / 2;
    ctx.fillText(text, box[0], y);
  }

  // ===== TOP-RIGHT: Outside temp block =====
  const outLeft = splitX;
  const outTop = contentTop;
  const outRight = contentRight;
  const outBottom = midY;

  // Header: "OUTSIDE TEMP"
  const outsideHeaderBox = [
    outLeft + 8,
    outTop + 4,
    outRight - 8,
    outTop + 40,
  ];
  {
    const headerText = "OUTSIDE TEMP";
    const { font, w, h } = fitTextInBox(
      ctx,
      headerText,
      outsideHeaderBox,
      28,
      16
    );
    ctx.font = font;
    const cx = (outsideHeaderBox[0] + outsideHeaderBox[2]) / 2;
    const cy = (outsideHeaderBox[1] + outsideHeaderBox[3]) / 2;
    ctx.fillText(headerText, cx - w / 2, cy - h / 2);
  }

  // Big outside temp value
  let tempStr = "\u2014"; // —
  if (temp != null) {
    const n = parseFloat(temp);
    tempStr = !Number.isNaN(n) ? `${n.toFixed(0)}${tempUnit}` : `${temp}${tempUnit}`;
  }

  const tempValueBox = [
    outLeft + 8,
    outsideHeaderBox[3] + 6,
    outRight - 8,
    outBottom - 40,
  ];
  {
    const { font, w, h } = fitTextInBox(ctx, tempStr, tempValueBox, 180, 70);
    ctx.font = font;
    const cx = (tempValueBox[0] + tempValueBox[2]) / 2;
    const cy = (tempValueBox[1] + tempValueBox[3]) / 2;
    ctx.fillText(tempStr, cx - w / 2, cy - h / 2);
  }

  // Wind chill, if any
  if (windChillValue != null) {
    const n = parseFloat(windChillValue);
    const wcStr = !Number.isNaN(n)
      ? `[${n.toFixed(0)}${tempUnit} wind chill]`
      : `[${windChillValue} ${tempUnit} wind chill]`;
    const wcBox = [outLeft + 8, outBottom - 36, outRight - 8, outBottom - 8];
    const { font, w, h } = fitTextInBox(ctx, wcStr, wcBox, 22, 12);
    ctx.font = font;
    const cx = (wcBox[0] + wcBox[2]) / 2;
    const cy = (wcBox[1] + wcBox[3]) / 2;
    ctx.fillText(wcStr, cx - w / 2, cy - h / 2);
  }

  // ===== BOTTOM-LEFT: 2x2 grid (inside temp, hot tub, humidity, icon) =====
  const blLeft = contentLeft;
  const blTop = midY;
  const blRight = splitX;
  const blBottom = contentBottom;

  const insideCell = [blLeft, blTop, leftMidX, bottomMidY];
  const hotTubCell = [leftMidX, blTop, blRight, bottomMidY];
  const humCell = [blLeft, bottomMidY, leftMidX, blBottom];
  const iconCell = [leftMidX, bottomMidY, blRight, blBottom];

  // Inside Temp
  let insideTempText = "\u2014";
  if (insideTempVal != null) {
    const unit = insideTempUnit || "°C";
    insideTempText = `${insideTempVal.toFixed(1)}${unit}`;
  }
  {
    const label = "Inside Temp";
    const labelBox = [
      insideCell[0] + 6,
      insideCell[1] + 4,
      insideCell[2] - 6,
      insideCell[1] + 26,
    ];
    const { font, w, h } = fitTextInBox(
      ctx,
      label,
      labelBox,
      22,
      LABEL_MIN_SIZE
    );
    ctx.font = font;
    const cx = (labelBox[0] + labelBox[2]) / 2;
    const cy = (labelBox[1] + labelBox[3]) / 2;
    ctx.fillText(label, cx - w / 2, cy - h / 2);

    const valueBox = [
      insideCell[0] + 6,
      labelBox[3] + 4,
      insideCell[2] - 6,
      insideCell[3] - 6,
    ];
    const vMetrics = fitTextInBox(ctx, insideTempText, valueBox, 80, 28);
    ctx.font = vMetrics.font;
    const vcx = (valueBox[0] + valueBox[2]) / 2;
    const vcy = (valueBox[1] + valueBox[3]) / 2;
    ctx.fillText(insideTempText, vcx - vMetrics.w / 2, vcy - vMetrics.h / 2);
  }

  // Hot Tub Temp
  let hottubTempText = "\u2014";
  if (hottubTempVal != null) {
    const unit = hottubTempUnit || "°C";
    hottubTempText = `${hottubTempVal.toFixed(1)}${unit}`;
  }
  {
    const label = "Hot Tub Temp";
    const labelBox = [
      hotTubCell[0] + 6,
      hotTubCell[1] + 4,
      hotTubCell[2] - 6,
      hotTubCell[1] + 26,
    ];
    const { font, w, h } = fitTextInBox(
      ctx,
      label,
      labelBox,
      22,
      LABEL_MIN_SIZE
    );
    ctx.font = font;
    const cx = (labelBox[0] + labelBox[2]) / 2;
    const cy = (labelBox[1] + labelBox[3]) / 2;
    ctx.fillText(label, cx - w / 2, cy - h / 2);

    const valueBox = [
      hotTubCell[0] + 6,
      labelBox[3] + 4,
      hotTubCell[2] - 6,
      hotTubCell[3] - 6,
    ];
    const vMetrics = fitTextInBox(ctx, hottubTempText, valueBox, 80, 28);
    ctx.font = vMetrics.font;
    const vcx = (valueBox[0] + valueBox[2]) / 2;
    const vcy = (valueBox[1] + valueBox[3]) / 2;
    ctx.fillText(hottubTempText, vcx - vMetrics.w / 2, vcy - vMetrics.h / 2);
  }

  // Inside Humidity
  let humText = "\u2014";
  if (insideHumVal != null) humText = `${insideHumVal.toFixed(0)}%`;
  {
    const label = "Inside Humidity";
    const labelBox = [
      humCell[0] + 6,
      humCell[1] + 4,
      humCell[2] - 6,
      humCell[1] + 26,
    ];
    const { font, w, h } = fitTextInBox(
      ctx,
      label,
      labelBox,
      22,
      LABEL_MIN_SIZE
    );
    ctx.font = font;
    const cx = (labelBox[0] + labelBox[2]) / 2;
    const cy = (labelBox[1] + labelBox[3]) / 2;
    ctx.fillText(label, cx - w / 2, cy - h / 2);

    const valueBox = [
      humCell[0] + 6,
      labelBox[3] + 4,
      humCell[2] - 6,
      humCell[3] - 6,
    ];
    const vMetrics = fitTextInBox(ctx, humText, valueBox, 80, 28);
    ctx.font = vMetrics.font;
    const vcx = (valueBox[0] + valueBox[2]) / 2;
    const vcy = (valueBox[1] + valueBox[3]) / 2;
    ctx.fillText(humText, vcx - vMetrics.w / 2, vcy - vMetrics.h / 2);
  }

  // Icon + tiny timestamp (bottom-right of bottom-left quadrant)
  const timeBandHeight = TIME_FONT_SIZE + 6;

  {
    const iconBox = [
      iconCell[0] + 6,
      iconCell[1] + 6,
      iconCell[2] - 6,
      iconCell[3] - 6 - timeBandHeight,
    ];
    await drawWeatherIcon(ctx, iconBox, condition, wAttrs);
  }

  // ISO timestamp, no "Updated"
  const timestampText = now.toISOString().slice(0, 16).replace("T", " ");
  ctx.font = fontSpec(TIME_FONT_SIZE);
  const { w: tsW, h: tsH } = textSize(ctx, timestampText);
  const tsCx = (iconCell[0] + iconCell[2]) / 2;
  const tsX = tsCx - tsW / 2;
  const tsY = iconCell[3] - tsH - 2;
  ctx.fillText(timestampText, tsX, tsY);

  // ===== BOTTOM-RIGHT: Location + Date =====
  const brLeft = splitX;
  const brTop = midY;
  const brRight = contentRight;
  const brBottom = contentBottom;

  const locBoxBottom = brTop + (brBottom - brTop) * 0.5;
  const dateBoxTop = locBoxBottom;

  // Location + Summary box (top half of bottom-right quadrant)
  const locBox = [brLeft, brTop, brRight, locBoxBottom];

  // "Location" header
  const locHeaderBox = [
    locBox[0] + 6,
    locBox[1] + 4,
    locBox[2] - 6,
    locBox[1] + 30,
  ];
  {
    const header = "Location";
    ctx.font = fontSpec(HEADER_LABEL_SIZE);
    const { w, h } = textSize(ctx, header);
    const cx = (locHeaderBox[0] + locHeaderBox[2]) / 2;
    const cy = (locHeaderBox[1] + locHeaderBox[3]) / 2;
    ctx.fillText(header, cx - w / 2, cy - h / 2);
  }
  const locRowsTop = locHeaderBox[3] + 8;
  const locRowsBottom = locBox[3] - 8;

  // Rows: 2 location rows, "Summary" header row, then 3 summary rows
  const locRowsData = [
    { type: "pair", label: "Dave", value: daveLoc },
    { type: "pair", label: "Kayla", value: kaylaLoc },
    { type: "header", text: "Summary" },
    { type: "pair", label: "Lights", value: lightsText },
    { type: "pair", label: "Fans", value: fansText },
    { type: "pair", label: "Torrents", value: torrentsText },
  ];

  const locRowCount = locRowsData.length;
  const locRowHeight = (locRowsBottom - locRowsTop) / locRowCount;
  const locMidX = locBox[0] + (locBox[2] - locBox[0]) / 2;

  const locRowBounds = [];

  for (let i = 0; i < locRowCount; i++) {
    const rowTop = locRowsTop + i * locRowHeight;
    const rowBottom =
      i === locRowCount - 1 ? locRowsBottom : rowTop + locRowHeight;
    const row = locRowsData[i];

    locRowBounds.push({ top: rowTop, bottom: rowBottom });

    if (row.type === "header") {
      // "Summary" centred across both columns, same size as "Location"
      const headerBox = [
        locBox[0] + 8,
        rowTop + 4,
        locBox[2] - 8,
        rowBottom - 4,
      ];
      ctx.font = fontSpec(HEADER_LABEL_SIZE);
      const { w, h } = textSize(ctx, row.text);
      const cx = (headerBox[0] + headerBox[2]) / 2;
      const cy = (headerBox[1] + headerBox[3]) / 2;
      ctx.fillText(row.text, cx - w / 2, cy - h / 2);
    } else {
      // Label/value row
      const leftBox = [
        locBox[0] + 8,
        rowTop + 4,
        locMidX - 4,
        rowBottom - 4,
      ];
      const rightBox = [
        locMidX + 4,
        rowTop + 4,
        locBox[2] - 8,
        rowBottom - 4,
      ];

      // Label
      {
        const { font, w, h } = fitTextInBox(
          ctx,
          row.label,
          leftBox,
          22,
          LABEL_MIN_SIZE
        );
        ctx.font = font;
        const cx = (leftBox[0] + leftBox[2]) / 2;
        const cy = (leftBox[1] + leftBox[3]) / 2;
        ctx.fillText(row.label, cx - w / 2, cy - h / 2);
      }

      // Value (auto-sized)
      {
        const { font, w, h } = fitTextInBox(
          ctx,
          row.value,
          rightBox,
          24,
          LABEL_MIN_SIZE
        );
        ctx.font = font;
        const cx = (rightBox[0] + rightBox[2]) / 2;
        const cy = (rightBox[1] + rightBox[3]) / 2;
        ctx.fillText(row.value, cx - w / 2, cy - h / 2);
      }
    }
  }

  // Date box: vertical DOW at left, month top-right, big day number below
  const dateBox = [brLeft, dateBoxTop, brRight, brBottom];

  const dateLeft = dateBox[0];
  const dateTop = dateBox[1];
  const dateRight = dateBox[2];
  const dateBottom = dateBox[3];

  const dateW = dateRight - dateLeft;
  const dateH = dateBottom - dateTop;

  // Narrow vertical stripe for DOW
  const dowAreaW = Math.min(dateW * 0.3, 80);
  const dowArea = [dateLeft, dateTop, dateLeft + dowAreaW, dateBottom];
  const rightArea = [dateLeft + dowAreaW, dateTop, dateRight, dateBottom];

  const dow = now
    .toLocaleString("en-US", { weekday: "short" })
    .toUpperCase();

  // 3-letter DOW, vertical, hugging left edge with a small margin
  {
    const [dl, dt, dr, db] = dowArea;
    const areaW = dr - dl;
    const areaH = db - dt;

    const { font, w, h } = fitTextInBox(
      ctx,
      dow,
      [0, 0, areaH - 8, areaW - 8],
      120,
      28
    );

    ctx.save();
    ctx.font = font;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";

    const cx = dl + 16; // a bit more to the right
    const cy = dt + areaH / 2;

    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2); // draw vertically
    ctx.fillText(dow, -w / 2, -h / 2);
    ctx.restore();
  }

  // Right area: month on top (right-aligned), big day number below
  const [raL, raT, raR, raB] = rightArea;
  const monthBox = [raL + 4, raT + 4, raR - 4, raT + dateH * 0.35];
  const dayBox = [raL + 4, monthBox[3] + 4, raR - 4, raB - 4];

  const monthName = now.toLocaleString("en-US", { month: "long" });

  // Month – right aligned at the top so it doesn't collide with DOW
  {
    const { font, w, h } = fitTextInBox(ctx, monthName, monthBox, 32, 16);
    ctx.font = font;
    const x = monthBox[2] - 2; // right edge with small inset
    const y = monthBox[1] + (monthBox[3] - monthBox[1] - h) / 2;
    ctx.fillText(monthName, x - w, y);
  }

  // Big day number + suffix using remaining space
  const dayNum = now.getDate();
  const dayStr = String(dayNum);
  const daySuffix = ordinalSuffix(dayNum);

  {
    const { font, w, h } = fitTextInBox(ctx, dayStr, dayBox, 180, 70);
    ctx.font = font;
    const cx = (dayBox[0] + dayBox[2]) / 2;
    const cy = (dayBox[1] + dayBox[3]) / 2;
    const dayX = cx - w / 2;
    const dayY = cy - h / 2;
    ctx.fillText(dayStr, dayX, dayY);

    // Small suffix in the top-right corner of the number
    const match = /(\d+)px/.exec(font);
    const baseSize = match ? parseInt(match[1], 10) : 24;
    const suffixSize = Math.max(10, Math.floor(baseSize * 0.3));
    ctx.font = fontSpec(suffixSize);
    const { w: sW, h: sH } = textSize(ctx, daySuffix);
    const suffixX = dayX + w + 4;
    const suffixY = dayY + 4;
    ctx.fillText(daySuffix, suffixX, suffixY);
  }

  // ===== GRID LINES =====
  ctx.save();
  ctx.strokeStyle = "#000000";

  // Outer border & major splits thicker
  ctx.lineWidth = 2;
  ctx.strokeRect(
    contentLeft,
    contentTop,
    contentRight - contentLeft,
    contentBottom - contentTop
  );

  // Vertical split (left/right)
  ctx.beginPath();
  ctx.moveTo(splitX, contentTop);
  ctx.lineTo(splitX, contentBottom);
  ctx.stroke();

  // Horizontal split (top/bottom)
  ctx.beginPath();
  ctx.moveTo(contentLeft, midY);
  ctx.lineTo(contentRight, midY);
  ctx.stroke();

  // Bottom-left inner vertical & horizontal (2x2)
  ctx.beginPath();
  ctx.moveTo(leftMidX, midY);
  ctx.lineTo(leftMidX, contentBottom);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(contentLeft, bottomMidY);
  ctx.lineTo(splitX, bottomMidY);
  ctx.stroke();

  // Bottom-right horizontal split (Location / Date)
  ctx.beginPath();
  ctx.moveTo(brLeft, locBoxBottom);
  ctx.lineTo(brRight, locBoxBottom);
  ctx.stroke();

  // Location inner vertical – skip the "Summary" row (index 2)
  if (locRowBounds.length >= 3) {
    const summaryBounds = locRowBounds[2];

    // From top to top of Summary
    ctx.beginPath();
    ctx.moveTo(locMidX, locRowsTop);
    ctx.lineTo(locMidX, summaryBounds.top);
    ctx.stroke();

    // From bottom of Summary to bottom
    ctx.beginPath();
    ctx.moveTo(locMidX, summaryBounds.bottom);
    ctx.lineTo(locMidX, locRowsBottom);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(locMidX, locRowsTop);
    ctx.lineTo(locMidX, locRowsBottom);
    ctx.stroke();
  }

  // Thinner detail lines
  ctx.lineWidth = 1;

  // Weather detail row lines:
  if (detailRowBounds.length > 0) {
    const firstTop = detailRowBounds[0].top;
    ctx.beginPath();
    ctx.moveTo(weatherLeft, firstTop);
    ctx.lineTo(weatherRight, firstTop);
    ctx.stroke();

    for (let i = 0; i < detailRowBounds.length - 1; i++) {
      const { bottom } = detailRowBounds[i];
      ctx.beginPath();
      ctx.moveTo(weatherLeft, bottom);
      ctx.lineTo(weatherRight, bottom);
      ctx.stroke();
    }
  }

  // Location row horizontal lines
  if (locRowBounds.length > 0) {
    const firstTop = locRowBounds[0].top;
    ctx.beginPath();
    ctx.moveTo(locBox[0], firstTop);
    ctx.lineTo(locBox[2], firstTop);
    ctx.stroke();

    for (let i = 0; i < locRowBounds.length - 1; i++) {
      const { bottom } = locRowBounds[i];
      ctx.beginPath();
      ctx.moveTo(locBox[0], bottom);
      ctx.lineTo(locBox[2], bottom);
      ctx.stroke();
    }
  }

  ctx.restore();

  return canvas;
}

// ===== Buffers for Kobo + PNG preview =====
async function buildKoboRawBuffer() {
  const landscape = await buildLandscapeCanvas();
  const portrait = rotateToPortrait(landscape);
  return portrait.toBuffer("raw", { colorType: "Gray8" });
}

async function buildPngBuffer(rotate = true) {
  const landscape = await buildLandscapeCanvas();
  const portrait =  rotate ? rotateToPortrait(landscape) : landscape;
  return portrait.toBuffer("png");
}

// ===== HTTP server =====
const server = http.createServer(async (req, res) => {
  try {
    if (req.url && req.url.startsWith("/kobo-dashboard.raw")) {
      const raw = await buildKoboRawBuffer();
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": raw.length,
      });
      res.end(raw);
      return;
    }

    if (req.url && req.url.startsWith("/kobo-dashboard.png")) {
      const png = await buildPngBuffer(false);
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": png.length,
      });
      res.end(png);
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  } catch (e) {
    const msg = `Error: ${e.message || String(e)}`;
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(msg);
  }
});

server.listen(BIND_PORT, BIND_HOST, () => {
  console.log(
    `Serving Kobo dashboard on:
  RAW: ${BIND_HOST}:${BIND_PORT}/kobo-dashboard.raw
  PNG: ${BIND_HOST}:${BIND_PORT}/kobo-dashboard.png
(canvas ${CANVAS_WIDTH}x${CANVAS_HEIGHT} rotated to 600x800, USB on right; GPU=${
      SKIA_USE_GPU ? "on" : "off"
    })`
  );
});
