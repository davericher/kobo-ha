// applianceIcons.js

/**
 * Draw washer icon in box
 * @param {CanvasRenderingContext2D} ctx
 * @param {[number,number,number,number]} box
 */
export function drawWasherIcon(ctx, box) {
    ctx.save();
    const [left, top, right, bottom] = box;
    const w = right - left;
    const h = bottom - top;
    if (w <= 0 || h <= 0) {
        ctx.restore();
        return;
    }

    const pad = Math.min(w, h) * 0.12;
    const ol = left + pad;
    const ot = top + pad;
    const or = right - pad;
    const ob = bottom - pad;
    const ow = or - ol;
    const oh = ob - ot;

    // outer
    ctx.lineWidth = 2;
    ctx.strokeRect(ol, ot, ow, oh);

    // control panel strip
    const panelH = oh * 0.25;
    ctx.beginPath();
    ctx.moveTo(ol, ot + panelH);
    ctx.lineTo(or, ot + panelH);
    ctx.stroke();

    // two knobs
    const knobR = panelH * 0.25;
    const kY = ot + panelH * 0.5;
    const spacing = ow / 3;
    for (let i = -0.5; i <= 0.5; i += 1) {
        const kX = ol + ow / 2 + i * spacing;
        ctx.beginPath();
        ctx.arc(kX, kY, knobR, 0, Math.PI * 2);
        ctx.stroke();
    }

    // door
    const doorPad = ow * 0.15;
    const dl = ol + doorPad;
    const dr = or - doorPad;
    const dt = ot + panelH + oh * 0.08;
    const db = ob - oh * 0.08;
    const cx = (dl + dr) / 2;
    const cy = (dt + db) / 2;
    const radius = Math.min((dr - dl) / 2, (db - dt) / 2);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
}

/**
 * Draw dryer icon in box
 * @param {CanvasRenderingContext2D} ctx
 * @param {[number,number,number,number]} box
 */
export function drawDryerIcon(ctx, box) {
    ctx.save();
    const [left, top, right, bottom] = box;
    const w = right - left;
    const h = bottom - top;
    if (w <= 0 || h <= 0) {
        ctx.restore();
        return;
    }

    const pad = Math.min(w, h) * 0.12;
    const ol = left + pad;
    const ot = top + pad;
    const or = right - pad;
    const ob = bottom - pad;
    const ow = or - ol;
    const oh = ob - ot;

    ctx.lineWidth = 2;
    ctx.strokeRect(ol, ot, ow, oh);

    const panelH = oh * 0.25;
    ctx.beginPath();
    ctx.moveTo(ol, ot + panelH);
    ctx.lineTo(or, ot + panelH);
    ctx.stroke();

    // small vent bar top-right
    const ventW = ow * 0.3;
    const ventH = panelH * 0.3;
    const vl = or - ventW - ow * 0.05;
    const vt = ot + panelH * 0.5 - ventH / 2;
    ctx.strokeRect(vl, vt, ventW, ventH);

    // big drum rectangle
    const dl = ol + ow * 0.18;
    const dr = or - ow * 0.18;
    const dt = ot + panelH + oh * 0.08;
    const db = ob - oh * 0.08;
    ctx.strokeRect(dl, dt, dr - dl, db - dt);

    ctx.restore();
}

/**
 * Draw oven icon in box
 * @param {CanvasRenderingContext2D} ctx
 * @param {[number,number,number,number]} box
 */
export function drawOvenIcon(ctx, box) {
    ctx.save();
    const [left, top, right, bottom] = box;
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) {
        ctx.restore();
        return;
    }

    const padding = Math.min(width, height) * 0.12;

    const outerLeft = left + padding;
    const outerTop = top + padding;
    const outerRight = right - padding;
    const outerBottom = bottom - padding;
    const outerW = outerRight - outerLeft;
    const outerH = outerBottom - outerTop;

    ctx.lineWidth = 2;
    ctx.strokeRect(outerLeft, outerTop, outerW, outerH);

    // Cooktop strip
    const cooktopHeight = outerH * 0.22;
    const cooktopBottom = outerTop + cooktopHeight;

    ctx.beginPath();
    ctx.moveTo(outerLeft, cooktopBottom);
    ctx.lineTo(outerRight, cooktopBottom);
    ctx.stroke();

    // evenly spaced burners (3 across)
    const burnerRadius = Math.min(outerW / 9, cooktopHeight / 3);
    const burnerY = outerTop + cooktopHeight * 0.5;
    const centers = [0.2, 0.5, 0.8].map((t) => outerLeft + outerW * t);

    for (const x of centers) {
        ctx.beginPath();
        ctx.arc(x, burnerY, burnerRadius, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Oven window (shifted down a couple of pixels)
    const winTop = cooktopBottom + outerH * 0.09 + 2;
    const winBottom = outerBottom - outerH * 0.08;
    const winLeft = outerLeft + outerW * 0.16;
    const winRight = outerRight - outerW * 0.16;
    ctx.strokeRect(winLeft, winTop, winRight - winLeft, winBottom - winTop);

    ctx.restore();
}

/**
 * Draw appliance status icons in a 2x2 grid
 * @param {CanvasRenderingContext2D} ctx
 * @param {[number,number,number,number]} box
 * @param {{washerOn:boolean, dryerOn:boolean, ovenOn:boolean}} param2
 */
export function drawDeviceStatusIcons(ctx, box, {washerOn, dryerOn, ovenOn}) {
    const [left, top, right, bottom] = box;
    const w = right - left;
    const h = bottom - top;
    if (w <= 0 || h <= 0) return;

    const midX = left + w / 2;
    const midY = top + h / 2;
    const pad = Math.min(w, h) * 0.06;

    const washerBox = [left + pad, top + pad, midX - pad, midY - pad];
    const dryerBox = [midX + pad, top + pad, right - pad, midY - pad];
    const ovenBox = [left + pad, midY + pad, midX - pad, bottom - pad];
    // bottom-right reserved for future (3D printer etc)

    if (washerOn) drawWasherIcon(ctx, washerBox);
    if (dryerOn) drawDryerIcon(ctx, dryerBox);
    if (ovenOn) drawOvenIcon(ctx, ovenBox);
}

/**
 * Draw 3D printer icon in box
 * @param ctx
 * @param box
 */
export function drawPrinterIcon(ctx, box) {
    const [left, top, right, bottom] = box;
    const w = right - left;
    const h = bottom - top;
    if (w <= 0 || h <= 0) return;

    const glyph = "🖶";
    const pad = Math.min(w, h) * 0.1;
    const innerBox = [left + pad, top + pad, right - pad, bottom - pad];
    const [bxL, bxT, bxR, bxB] = innerBox;
    const boxW = bxR - bxL;
    const boxH = bxB - bxT;

    // Pick a font size that fits
    let size = Math.floor(Math.min(boxW, boxH));
    for (; size > 8; size -= 2) {
        ctx.save();
        ctx.font = `${size}px "Noto Emoji", "Symbola", "FreeSans", "DejaVu Sans"`;
        const m = ctx.measureText(glyph);
        ctx.restore();
        if (m.width <= boxW && size <= boxH) break;
    }

    ctx.save();
    ctx.font = `${size}px "Noto Emoji", "Symbola", "FreeSans", "DejaVu Sans"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, (bxL + bxR) / 2, (bxT + bxB) / 2);
    ctx.restore();
}

