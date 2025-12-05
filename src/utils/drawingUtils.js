// drawingUtils.js
import {Canvas} from "skia-canvas";
import {CANVAS_WIDTH, CANVAS_HEIGHT, SKIA_USE_GPU} from "../config.js";

/**
 * Generate font spec string
 * @param {number} size
 * @returns {string}
 */
export function fontSpec(size) {
    // Try DejaVu first, then FreeSans, then Noto Emoji as a last resort
    return `${size}px "DejaVu Sans","FreeSans","Noto Emoji",sans-serif`;
}

/**
 * Measure text size
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @returns {{w: number, h: number}}
 */
export function textSize(ctx, text) {
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
    return {w, h};
}

/**
 * Fit text in box by adjusting font size
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {[number,number,number,number]} box
 * @param {number} maxSize
 * @param {number} minSize
 * @returns {{font: string, w: number, h: number}}
 */
export function fitTextInBox(ctx, text, box, maxSize, minSize) {
    const [left, top, right, bottom] = box;
    const boxW = Math.max(1, right - left);
    const boxH = Math.max(1, bottom - top);

    for (let size = maxSize; size >= minSize; size -= 2) {
        ctx.save();
        ctx.font = fontSpec(size);
        const {w, h} = textSize(ctx, text);
        ctx.restore();
        if (w <= boxW && h <= boxH) {
            return {font: fontSpec(size), w, h};
        }
    }

    ctx.save();
    ctx.font = fontSpec(minSize);
    const {w, h} = textSize(ctx, text);
    ctx.restore();
    return {font: fontSpec(minSize), w, h};
}

/**
 * Create a base white canvas with sensible text defaults.
 * Useful for any screen.
 * @param {number} [width]
 * @param {number} [height]
 * @param {string} [background]
 * @returns {{canvas: Canvas, ctx: CanvasRenderingContext2D}}
 */
export function createBaseCanvas(
    width = CANVAS_WIDTH,
    height = CANVAS_HEIGHT,
    background = "#ffffff"
) {
    const canvas = new Canvas(width, height, {gpu: SKIA_USE_GPU});
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#000000";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";

    return {canvas, ctx};
}

/**
 * Rotate a landscape canvas to portrait (USB on the right)
 * Default dimensions: 600x800 from 800x600.
 * @param {Canvas} canvas
 * @param {number} [width]
 * @param {number} [height]
 * @returns {Canvas}
 */
export function rotateToPortrait(
    canvas,
    width = CANVAS_HEIGHT,
    height = CANVAS_WIDTH
) {
    const rotated = new Canvas(width, height, {gpu: SKIA_USE_GPU});
    const rctx = rotated.getContext("2d");

    rctx.fillStyle = "#ffffff";
    rctx.fillRect(0, 0, width, height);

    rctx.setTransform(1, 0, 0, 1, 0, 0);
    rctx.translate(0, height);
    rctx.rotate(-Math.PI / 2);
    rctx.drawImage(canvas, 0, 0);

    return rotated;
}
