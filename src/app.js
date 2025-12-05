#!/usr/bin/env node

import express from "express";
import {buildKoboRawBuffer, buildPngBuffer} from "./renderers/dashboard.js";
import {initHomeAssistant} from "./clients/haClient.js";
import {BIND_HOST, BIND_PORT, CANVAS_WIDTH, CANVAS_HEIGHT} from "./config.js";

initHomeAssistant();

const app = express();

/**
 * Serve RAW image for Kobo
 * @param req
 * @param res
 * @returns {Promise<void>}
 */
const rawImage = async (req, res) => {
    try {
        const raw = await buildKoboRawBuffer();
        res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Length": raw.length,
        });
        res.end(raw);
    } catch (e) {
        console.error("Error building RAW dashboard:", e);
        res.status(500).send(e.message || "Error building RAW dashboard");
    }
}

/**
 * Serve PNG image
 * @param req
 * @param res
 * @returns {Promise<void>}
 */
const pngImage = async (req, res) => {
    try {
        const rotate = req.query.rotate !== "false";
        const png = await buildPngBuffer(rotate);
        res.writeHead(200, {
            "Content-Type": "image/png",
            "Content-Length": png.length,
        });
        res.end(png);
    } catch (e) {
        console.error("Error building PNG dashboard:", e);
        res.status(500).send(e.message || "Error building PNG dashboard");
    }
}

/**
 * Serve simple HTML dashboard viewer
 * @param req
 * @param res
 */
const koboDashboard = (req, res) => {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Kobo Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background: #000;
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    img {
      max-width: 100%;
      max-height: 100%;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
      display: block;
    }
  </style>
</head>
<body>
  <img id="dash" src="/kobo-dashboard.png" alt="Kobo dashboard">
  <script>
    const img = document.getElementById('dash');
    const intervalMs = 60000; // 1 minute
    function refresh() {
      img.src = '/kobo-dashboard.png?t=' + Date.now();
    }
    setInterval(refresh, intervalMs);
  </script>
</body>
</html>`;
    res
        .status(200)
        .set("Content-Type", "text/html; charset=utf-8")
        .send(html);
}

/**
 * Basic health check endpoint
 * @param req
 * @param res
 */
const healthCheck =  (req, res) => {
    res.json({ok: true});
}

/**
 * 404 fallback handler
 * @param req
 * @param res
 */
const notFoundFallback = (req, res) => {
    res.status(404).send("Not found");
}

app.get("/kobo-dashboard.raw", rawImage);
app.get("/kobo-dashboard.png", pngImage);
app.get("/kobo-dashboard", koboDashboard);
app.get("/health",healthCheck);
app.use(notFoundFallback);

app.listen(BIND_PORT, BIND_HOST, () => {
    console.log(
        `Serving Kobo dashboard on:
  RAW:  http://${BIND_HOST}:${BIND_PORT}/kobo-dashboard.raw
  PNG:  http://${BIND_HOST}:${BIND_PORT}/kobo-dashboard.png
  HTML: http://${BIND_HOST}:${BIND_PORT}/kobo-dashboard
(canvas ${CANVAS_WIDTH}x${CANVAS_HEIGHT} rotated to 600x800, USB on right)`
    );
});
