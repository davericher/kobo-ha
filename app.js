#!/usr/bin/env node
// app.js
// Kobo dashboard server using skia-canvas, with RAW + PNG outputs

import http from "node:http";
import { Canvas, loadImage } from "skia-canvas";

// ===== Config via environment variables =====
const HA_URL = (process.env.HA_URL || "http://homeassistant:8123").replace(/\/+$/, "");
const HA_TOKEN = process.env.HA_TOKEN || "";

const WEATHER_ENTITY = process.env.WEATHER_ENTITY || "weather.ironynet";
const DL_ENTITY = process.env.DL_ENTITY || "sensor.transmission_download_speed";
const UL_ENTITY = process.env.UL_ENTITY || "sensor.transmission_upload_speed";

// Inside sensors
const INSIDE_TEMP_ENTITY = process.env.INSIDE_TEMP_ENTITY || "";
const INSIDE_HUMIDITY_ENTITY = process.env.INSIDE_HUMIDITY_ENTITY || "";
const HOTTUB_TEMP_ENTITY = process.env.HOTTUB_TEMP_ENTITY || "";

const BIND_HOST = process.env.BIND_HOST || "0.0.0.0";
const BIND_PORT = parseInt(process.env.BIND_PORT || "8080", 10);

// Logical canvas in LANDSCAPE. We’ll rotate it at the end to 600x800 portrait.
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

const HA_HEADERS = {
  ...(HA_TOKEN ? { Authorization: `Bearer ${HA_TOKEN}` } : {}),
  "Content-Type": "application/json",
};

// ===== Helpers =====

function fontSpec(size) {
  // DejaVu Sans is installed in the Dockerfile
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

async function haState(entityId) {
  const url = `${HA_URL}/api/states/${entityId}`;
  const res = await fetch(url, { headers: HA_HEADERS });
  if (!res.ok) {
    throw new Error(`HA ${entityId} HTTP ${res.status}`);
  }
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
  if (!Number.isNaN(n)) {
    return `${n.toFixed(1)} ${unit}`.trim();
  }
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
    const value = parseFloat(state);
    if (Number.isNaN(value)) {
      return [null, attrs.unit_of_measurement, attrs];
    }
    return [value, attrs.unit_of_measurement, attrs];
  } catch {
    return [null, null, {}];
  }
}

async function drawWeatherIcon(ctx, box, condition, wAttrs) {
  const [left, top, right, bottom] = box;
  const boxW = Math.max(1, right - left);
  const boxH = Math.max(1, bottom - top);

  let iconUrl = wAttrs?.entity_picture;
  if (iconUrl && typeof iconUrl === "string") {
    if (iconUrl.startsWith("/")) {
      iconUrl = `${HA_URL}${iconUrl}`;
    }
    try {
      const img = await loadImage(iconUrl, {
        headers: HA_HEADERS,
      });
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
      // fall through to glyph
    }
  }

  // Fallback: big unicode glyph
  const glyph = iconForCondition(condition);
  const { font, w, h } = fitTextInBox(ctx, glyph, box, 260, 80);
  ctx.save();
  ctx.font = font;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.fillText(glyph, x, y);
  ctx.restore();
}

// Rotate landscape -> portrait (600x800), USB on the right like before
function rotateToPortrait(canvas) {
  const rotated = new Canvas(600, 800, { gpu: false });
  const rctx = rotated.getContext("2d");
  rctx.fillStyle = "#ffffff";
  rctx.fillRect(0, 0, rotated.width, rotated.height);

  // rotate -90° so USB is on the right
  rctx.translate(0, rotated.height);
  rctx.rotate(-Math.PI / 2);
  rctx.drawImage(canvas, 0, 0);

  return rotated;
}

// ===== Main LANDSCAPE renderer (shared by RAW + PNG) =====
async function buildLandscapeCanvas() {
  const canvas = new Canvas(CANVAS_WIDTH, CANVAS_HEIGHT, { gpu: false });
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  // Font sizes (mirror Python)
  const COND_SIZE = 56;
  const DETAIL_SIZE = 32;
  const TX_LABEL_SIZE = 26;
  const TX_VALUE_SIZE = 24;
  const SMALL_SIZE = 20;

  const margin = 24;
  const splitX = 420; // left/right column boundary
  const leftColRight = splitX - 10;
  const leftInnerWidth = leftColRight - margin;
  const leftMidSplit = margin + Math.floor(leftInnerWidth / 2);

  // ===== Fetch weather data =====
  let weatherState, wAttrs;
  try {
    [weatherState, wAttrs] = await haState(WEATHER_ENTITY);
  } catch (e) {
    ctx.font = fontSpec(DETAIL_SIZE);
    ctx.fillText("Error reading weather", margin, margin);
    ctx.font = fontSpec(SMALL_SIZE);
    ctx.fillText(String(e), margin, margin + DETAIL_SIZE + 4);
    return canvas;
  }

  const condition = weatherState;
  const temp = wAttrs.temperature;
  const tempUnit = wAttrs.temperature_unit || "°C";

  const humidity = wAttrs.humidity;
  const pressure = wAttrs.pressure;
  const windSpeed = wAttrs.wind_speed ?? wAttrs.native_wind_speed;
  const windSpeedUnit =
    wAttrs.wind_speed_unit ?? wAttrs.native_wind_speed_unit ?? "m/s";
  const windBearing = wAttrs.wind_bearing;
  const cloudCoverage = wAttrs.cloud_coverage;
  const uvIndex = wAttrs.uv_index;

  // Optional "feels like" / wind chill
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

  // Transmission
  let dlText = "ERR";
  let ulText = "ERR";
  try {
    const [dlState, dlAttrs] = await haState(DL_ENTITY);
    const [ulState, ulAttrs] = await haState(UL_ENTITY);
    dlText = formatSpeed(dlState, dlAttrs);
    ulText = formatSpeed(ulState, ulAttrs);
  } catch {
    // keep ERR
  }

  // Inside sensors
  const [insideTempVal, insideTempUnit] = await numericState(INSIDE_TEMP_ENTITY);
  const [insideHumVal] = await numericState(INSIDE_HUMIDITY_ENTITY);
  const [hottubTempVal, hottubTempUnit] = await numericState(HOTTUB_TEMP_ENTITY);

  // ===== LEFT COLUMN TOP: weather summary =====
  let xLeft = margin;
  let y = margin;

  ctx.font = fontSpec(COND_SIZE);
  const condText =
    (condition || "").charAt(0).toUpperCase() + (condition || "").slice(1);
  ctx.fillText(condText, xLeft, y);
  y += COND_SIZE + 16;

  function addDetail(label, value) {
    ctx.font = fontSpec(DETAIL_SIZE);
    const text = `${label}: ${value}`;
    ctx.fillText(text, xLeft, y);
    y += DETAIL_SIZE + 8;
  }

  if (humidity != null) addDetail("Humidity", `${humidity}%`);
  if (pressure != null) addDetail("Pressure", `${pressure} hPa`);

  if (windSpeed != null) {
    let wsStr;
    const n = parseFloat(windSpeed);
    if (!Number.isNaN(n)) {
      wsStr = `${n.toFixed(1)} ${windSpeedUnit}`;
    } else {
      wsStr = `${windSpeed} ${windSpeedUnit}`;
    }
    const bearing = windBearing ? ` (${windBearing})` : "";
    addDetail("Wind", `${wsStr}${bearing}`);
  }

  if (cloudCoverage != null) addDetail("Clouds", `${cloudCoverage}%`);
  if (uvIndex != null) addDetail("UV Index", String(uvIndex));

  const weatherBlockBottom = y;

  // ===== LEFT COLUMN MIDDLE: inside temp + hot tub temp =====
  let insideRowTop = Math.max(
    weatherBlockBottom + 12,
    Math.floor(CANVAS_HEIGHT * 0.45)
  );
  let insideRowBottom = insideRowTop + 90;
  if (insideRowBottom > CANVAS_HEIGHT - 160) {
    insideRowBottom = CANVAS_HEIGHT - 160;
    insideRowTop = insideRowBottom - 90;
  }

  const LABEL_FONT = fontSpec(SMALL_SIZE);

  // Inside temp (left mid)
  let insideTempText = "—";
  if (insideTempVal != null) {
    const unit = insideTempUnit || "°C";
    insideTempText = `${insideTempVal.toFixed(1)}${unit}`;
  }

  const boxInsideLeft = [margin, insideRowTop, leftMidSplit - 5, insideRowBottom];
  ctx.font = LABEL_FONT;
  ctx.fillText("Inside Temp", boxInsideLeft[0], boxInsideLeft[1] + 2);

  const valueBoxInsideLeft = [
    boxInsideLeft[0],
    boxInsideLeft[1] + SMALL_SIZE + 4,
    boxInsideLeft[2],
    boxInsideLeft[3] - 4,
  ];
  {
    const { font, w, h } = fitTextInBox(
      ctx,
      insideTempText,
      valueBoxInsideLeft,
      70,
      32
    );
    ctx.font = font;
    const cx = (valueBoxInsideLeft[0] + valueBoxInsideLeft[2]) / 2;
    const cy = (valueBoxInsideLeft[1] + valueBoxInsideLeft[3]) / 2;
    ctx.fillText(insideTempText, cx - w / 2, cy - h / 2);
  }

  // Hot tub temp (right mid)
  let hottubTempText = "—";
  if (hottubTempVal != null) {
    const unit = hottubTempUnit || "°C";
    hottubTempText = `${hottubTempVal.toFixed(1)}${unit}`;
  }

  const boxHottub = [leftMidSplit + 5, insideRowTop, leftColRight, insideRowBottom];
  ctx.font = LABEL_FONT;
  ctx.fillText("Hot Tub Temp", boxHottub[0], boxHottub[1] + 2);

  const valueBoxHottub = [
    boxHottub[0],
    boxHottub[1] + SMALL_SIZE + 4,
    boxHottub[2],
    boxHottub[3] - 4,
  ];
  {
    const { font, w, h } = fitTextInBox(
      ctx,
      hottubTempText,
      valueBoxHottub,
      70,
      32
    );
    ctx.font = font;
    const cx = (valueBoxHottub[0] + valueBoxHottub[2]) / 2;
    const cy = (valueBoxHottub[1] + valueBoxHottub[3]) / 2;
    ctx.fillText(hottubTempText, cx - w / 2, cy - h / 2);
  }

  // ===== LEFT COLUMN BOTTOM: inside humidity + transmission =====
  let humidityRowTop = insideRowBottom + 10;
  let humidityRowBottom = CANVAS_HEIGHT - margin - 45;
  if (humidityRowBottom <= humidityRowTop + 20) {
    humidityRowTop = CANVAS_HEIGHT - 200;
    humidityRowBottom = CANVAS_HEIGHT - margin - 45;
  }

  // Inside humidity (bottom-left)
  let humText = "--";
  if (insideHumVal != null) {
    humText = `${insideHumVal.toFixed(0)}%`;
  }

  const boxHum = [margin, humidityRowTop, leftMidSplit - 5, humidityRowBottom];
  ctx.font = LABEL_FONT;
  ctx.fillText("Inside Humidity", boxHum[0], boxHum[1] + 2);

  const valueBoxHum = [
    boxHum[0],
    boxHum[1] + SMALL_SIZE + 4,
    boxHum[2],
    boxHum[3] - 4,
  ];
  {
    const { font, w, h } = fitTextInBox(ctx, humText, valueBoxHum, 80, 32);
    ctx.font = font;
    const cx = (valueBoxHum[0] + valueBoxHum[2]) / 2;
    const cy = (valueBoxHum[1] + valueBoxHum[3]) / 2;
    ctx.fillText(humText, cx - w / 2, cy - h / 2);
  }

  // Transmission (bottom-right of left column)
  const boxTx = [leftMidSplit + 5, humidityRowTop, leftColRight, humidityRowBottom];
  const txCx = (boxTx[0] + boxTx[2]) / 2;
  const txCy = (boxTx[1] + boxTx[3]) / 2;
  const totalTxHeight = TX_LABEL_SIZE + TX_VALUE_SIZE * 2 + 10;
  let startY = txCy - totalTxHeight / 2;

  ctx.font = fontSpec(TX_LABEL_SIZE);
  ctx.fillText("Transmission", boxTx[0], startY);

  startY += TX_LABEL_SIZE + 4;
  ctx.font = fontSpec(TX_VALUE_SIZE);
  ctx.fillText(`Up:   ${ulText}`, boxTx[0], startY);

  startY += TX_VALUE_SIZE + 2;
  ctx.fillText(`Down: ${dlText}`, boxTx[0], startY);

  // Updated timestamp bottom-left
  const now = new Date();
  const updatedText = `Updated: ${now.toISOString().slice(0, 16).replace("T", " ")}`;
  ctx.font = fontSpec(SMALL_SIZE);
  const { h: updH } = textSize(ctx, updatedText);
  const updX = margin;
  const updY = CANVAS_HEIGHT - margin - updH;
  ctx.fillText(updatedText, updX, updY);

  // ===== RIGHT COLUMN TOP: outside temp and optional wind chill =====
  let tempStr = "—";
  if (temp != null) {
    const n = parseFloat(temp);
    if (!Number.isNaN(n)) {
      tempStr = `${n.toFixed(0)}${tempUnit}`;
    } else {
      tempStr = `${temp}${tempUnit}`;
    }
  }

  const tempBoxLeft = splitX + 10;
  const tempBoxTop = margin;
  const tempBoxRight = CANVAS_WIDTH - margin;
  const tempBoxBottom = CANVAS_HEIGHT / 2 - 20;
  const tempTextBox = [tempBoxLeft, tempBoxTop, tempBoxRight, tempBoxBottom - 30];

  {
    const { font, w, h } = fitTextInBox(ctx, tempStr, tempTextBox, 180, 80);
    ctx.font = font;
    const cx = (tempTextBox[0] + tempTextBox[2]) / 2;
    const cy = (tempTextBox[1] + tempTextBox[3]) / 2;
    const x = cx - w / 2;
    const yMid = cy - h / 2;
    ctx.fillText(tempStr, x, yMid);
  }

  if (windChillValue != null) {
    let wcStr;
    const n = parseFloat(windChillValue);
    if (!Number.isNaN(n)) {
      wcStr = `[${n.toFixed(0)}${tempUnit} wind chill]`;
    } else {
      wcStr = `[${windChillValue} ${tempUnit} wind chill]`;
    }
    ctx.font = fontSpec(SMALL_SIZE);
    const { w: wcW, h: wcH } = textSize(ctx, wcStr);
    const wcCx = (tempBoxLeft + tempBoxRight) / 2;
    const wcX = wcCx - wcW / 2;
    const wcY = tempBoxBottom - wcH - 4;
    ctx.fillText(wcStr, wcX, wcY);
  }

  // ===== RIGHT COLUMN BOTTOM: weather icon image (or glyph) =====
  const iconBoxLeft = splitX + 10;
  const iconBoxTop = CANVAS_HEIGHT / 2 + 10;
  const iconBoxRight = CANVAS_WIDTH - margin;
  const iconBoxBottom = CANVAS_HEIGHT - margin - 10;

  await drawWeatherIcon(
    ctx,
    [iconBoxLeft, iconBoxTop, iconBoxRight, iconBoxBottom],
    condition,
    wAttrs
  );

  return canvas;
}

// ===== Buffers for Kobo + PNG preview =====
async function buildKoboRawBuffer() {
  const landscape = await buildLandscapeCanvas();
  const portrait = rotateToPortrait(landscape);
  return portrait.toBuffer("raw", { colorType: "Gray8" });
}

async function buildPngBuffer() {
  const landscape = await buildLandscapeCanvas();
  const portrait = rotateToPortrait(landscape);
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
      const png = await buildPngBuffer();
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
(canvas ${CANVAS_WIDTH}x${CANVAS_HEIGHT} rotated to 600x800, USB on right)`
  );
});
