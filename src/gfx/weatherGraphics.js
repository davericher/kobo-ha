// weatherGraphics.js
import {loadImage} from "skia-canvas";
import {HA_URL, HA_HEADERS} from "../config.js";
import {fontSpec, textSize} from "../utils/drawingUtils.js";

/**
 * Get icon glyph for weather condition
 * @param {string} condition
 * @returns {string}
 */
export function iconForCondition(condition) {
    const c = (condition || "").toLowerCase();
    const mapping = {
        sunny: "☀",
        clear: "☀",
        "clear-night": "☾",
        cloudy: "☁",
        "partly-cloudy": "⛅",
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

/**
 * Draw weather icon (HA entity_picture if available, otherwise glyph)
 * @param {CanvasRenderingContext2D} ctx
 * @param {[number,number,number,number]} box
 * @param {string} condition
 * @param {object} wAttrs
 * @returns {Promise<void>}
 */
export async function drawWeatherIcon(ctx, box, condition, wAttrs) {
    const [left, top, right, bottom] = box;
    const boxW = Math.max(1, right - left);
    const boxH = Math.max(1, bottom - top);

    // Try HA entity_picture first
    let iconUrl = wAttrs?.entity_picture;
    if (iconUrl && typeof iconUrl === "string") {
        if (iconUrl.startsWith("/")) iconUrl = `${HA_URL}${iconUrl}`;
        try {
            const img = await loadImage(iconUrl, {headers: HA_HEADERS});
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

    // Fallback: glyph centered in box
    const glyph = iconForCondition(condition);
    const maxSize = Math.min(boxH - 10, 260);
    let chosenSize = 80;

    for (let size = maxSize; size >= 80; size -= 2) {
        ctx.save();
        ctx.font = fontSpec(size);
        const {w} = textSize(ctx, glyph);
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
