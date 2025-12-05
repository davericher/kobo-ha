// dashboard.js
import {
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    WEATHER_ENTITY,
    DL_ENTITY,
    UL_ENTITY,
    INSIDE_TEMP_ENTITY,
    INSIDE_HUMIDITY_ENTITY,
    HOTTUB_TEMP_ENTITY,
    LIGHTS_ON_ENTITY,
    FANS_ON_ENTITY,
    TORRENTS_ENTITY,
    PERSON_DAVE_ENTITY,
    PERSON_KAYLA_ENTITY,
    WASHER_POWER_ENTITY,
    DRYER_POWER_ENTITY,
    RANGE_STATE_ENTITY,
} from "../config.js";
import {haState, numericState, stringState} from "../clients/haClient.js";
import {
    createBaseCanvas,
    rotateToPortrait,
    fontSpec,
    textSize,
    fitTextInBox,
} from "../utils/drawingUtils.js";
import {
    formatSpeed,
    formatPersonLocation,
    ordinalSuffix,
} from "../utils/textUtils.js";
import {drawWeatherIcon} from "../gfx/weatherGraphics.js";
import {drawDeviceStatusIcons} from "../gfx/applianceIcons.js";

/**
 * Build landscape canvas
 * @returns {Promise<import("skia-canvas").Canvas>}
 */
export async function buildLandscapeCanvas() {
    const {canvas, ctx} = createBaseCanvas();
    const now = new Date();

    const COND_MAX_SIZE = 56;
    const DETAIL_MAX_SIZE = 28;
    const LABEL_MIN_SIZE = 14;
    const SMALL_SIZE = 18;
    const TIME_FONT_SIZE = 10;

    const margin = 12;
    const contentLeft = margin;
    const contentRight = CANVAS_WIDTH - margin;
    const contentTop = margin;
    const contentBottom = CANVAS_HEIGHT - margin;

    const splitX = 420; // left/right
    const midY = CANVAS_HEIGHT / 2; // top/bottom

    const leftColWidth = splitX - contentLeft;
    const leftMidX = contentLeft + leftColWidth / 2;

    const bottomHeight = contentBottom - midY;
    const bottomMidY = midY + bottomHeight / 2;

    // ===== Fetch weather data =====
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

    // Transmission
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
    const [insideTempVal, insideTempUnit] = await numericState(INSIDE_TEMP_ENTITY);
    const [insideHumVal] = await numericState(INSIDE_HUMIDITY_ENTITY);
    const [hottubTempVal, hottubTempUnit] = await numericState(
        HOTTUB_TEMP_ENTITY
    );

    // Location / counts
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

    // Appliance states
    const [washerRaw] = await stringState(WASHER_POWER_ENTITY);
    const [dryerRaw] = await stringState(DRYER_POWER_ENTITY);
    const [rangeRaw] = await stringState(RANGE_STATE_ENTITY);

    const washerOn = String(washerRaw || "").toLowerCase() === "on";
    const dryerOn = String(dryerRaw || "").toLowerCase() === "on";
    const ovenOn = String(rangeRaw || "").toLowerCase() === "running";

    // ===== TOP-LEFT: Weather summary =====
    const weatherLeft = contentLeft;
    const weatherTop = contentTop;
    const weatherRight = splitX;
    const weatherBottom = midY;

    const condBox = [
        weatherLeft + 6,
        weatherTop + 4,
        weatherRight - 6,
        weatherTop + 60,
    ];
    const condText =
        (condition || "").charAt(0).toUpperCase() + (condition || "").slice(1);
    {
        const {font, w, h} = fitTextInBox(
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

    const detailStartY = condBox[3] + 6;
    const detailBottom = weatherBottom - 6;
    const detailRowsCount = 6;
    const detailRowHeight = (detailBottom - detailStartY) / detailRowsCount;

    const detailTexts = (() => {
        const humStr = humidityOut != null ? `${humidityOut}%` : "\u2014";
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
        detailRowBounds.push({top: rowTop, bottom: rowBottom});

        const box = [weatherLeft + 8, rowTop + 2, weatherRight - 8, rowBottom - 2];
        const text = detailTexts[i] || "";
        const {font, h} = fitTextInBox(
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

    // ===== TOP-RIGHT: Outside temp =====
    const outLeft = splitX;
    const outTop = contentTop;
    const outRight = contentRight;
    const outBottom = midY;

    const outsideHeaderBox = [
        outLeft + 8,
        outTop + 4,
        outRight - 8,
        outTop + 40,
    ];
    {
        const headerText = "Outside Temp";
        const {font, w, h} = fitTextInBox(
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

    let tempStr = "\u2014";
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
        const {font, w, h} = fitTextInBox(ctx, tempStr, tempValueBox, 180, 70);
        ctx.font = font;
        const cx = (tempValueBox[0] + tempValueBox[2]) / 2;
        const cy = (tempValueBox[1] + tempValueBox[3]) / 2;
        ctx.fillText(tempStr, cx - w / 2, cy - h / 2);
    }

    if (windChillValue != null) {
        const n = parseFloat(windChillValue);
        const wcStr = !Number.isNaN(n)
            ? `[${n.toFixed(0)}${tempUnit} wind chill]`
            : `[${windChillValue} ${tempUnit} wind chill]`;
        const wcBox = [outLeft + 8, outBottom - 36, outRight - 8, outBottom - 8];
        const {font, w, h} = fitTextInBox(ctx, wcStr, wcBox, 22, 12);
        ctx.font = font;
        const cx = (wcBox[0] + wcBox[2]) / 2;
        const cy = (wcBox[1] + wcBox[3]) / 2;
        ctx.fillText(wcStr, cx - w / 2, cy - h / 2);
    }

    // ===== BOTTOM-LEFT: 2x2 grid =====
    const blLeft = contentLeft;
    const blTop = midY;
    const blRight = splitX;
    const blBottom = contentBottom;

    const insideCell = [blLeft, blTop, leftMidX, bottomMidY];
    const hotTubCell = [leftMidX, blTop, blRight, bottomMidY];
    const humCell = [blLeft, bottomMidY, leftMidX, blBottom];
    const iconCell = [leftMidX, bottomMidY, blRight, blBottom];

    // Inside temp
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
        const {font, w, h} = fitTextInBox(
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

    // Hot tub
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
        const {font, w, h} = fitTextInBox(
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

    // Inside humidity
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
        const {font, w, h} = fitTextInBox(
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

    // Icon + timestamp
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
    const timestampText = now.toISOString().slice(0, 16).replace("T", " ");
    ctx.font = fontSpec(TIME_FONT_SIZE);
    const {w: tsW, h: tsH} = textSize(ctx, timestampText);
    const tsCx = (iconCell[0] + iconCell[2]) / 2;
    const tsX = tsCx - tsW / 2;
    const tsY = iconCell[3] - tsH - 2;
    ctx.fillText(timestampText, tsX, tsY);

    // ===== BOTTOM-RIGHT: Location + Date + Appliances block =====
    const brLeft = splitX;
    const brTop = midY;
    const brRight = contentRight;
    const brBottom = contentBottom;

    const locBoxBottom = brTop + (brBottom - brTop) * 0.5;
    const dateBoxTop = locBoxBottom;

    const locBox = [brLeft, brTop, brRight, locBoxBottom];

    const locRowsTop = locBox[1] + 6;
    const locRowsBottom = locBox[3] - 6;

    const locRowsData = [
        {label: "Dave", value: daveLoc},
        {label: "Kayla", value: kaylaLoc},
        {label: "Lights", value: lightsText},
        {label: "Fans", value: fansText},
        {label: "Torrents", value: torrentsText},
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

        locRowBounds.push({top: rowTop, bottom: rowBottom});

        const leftBox = [locBox[0] + 8, rowTop + 2, locMidX - 4, rowBottom - 2];
        const rightBox = [locMidX + 4, rowTop + 2, locBox[2] - 8, rowBottom - 2];
        const verticalNudge = 2;

        {
            const {font, w, h} = fitTextInBox(
                ctx,
                row.label,
                leftBox,
                22,
                LABEL_MIN_SIZE
            );
            ctx.font = font;
            const cx = (leftBox[0] + leftBox[2]) / 2;
            const cy = (leftBox[1] + leftBox[3]) / 2;
            const textY = cy - h / 2 - verticalNudge;
            ctx.fillText(row.label, cx - w / 2, textY);
        }
        {
            const {font, w, h} = fitTextInBox(
                ctx,
                row.value,
                rightBox,
                24,
                LABEL_MIN_SIZE
            );
            ctx.font = font;
            const cx = (rightBox[0] + rightBox[2]) / 2;
            const cy = (rightBox[1] + rightBox[3]) / 2;
            const textY = cy - h / 2 - verticalNudge;
            ctx.fillText(row.value, cx - w / 2, textY);
        }
    }

    // Date box (left side of bottom-right)
    const dateBox = [brLeft, dateBoxTop, brRight, brBottom];

    const dateLeft = dateBox[0];
    const dateTop = dateBox[1];
    const dateRight = dateBox[2];
    const dateBottom = dateBox[3];

    const dateW = dateRight - dateLeft;

    const dowAreaW = Math.min(dateW * 0.3, 80);
    const dowArea = [dateLeft, dateTop, dateLeft + dowAreaW, dateBottom];

    const rightArea = [dateLeft + dowAreaW, dateTop, locMidX, dateBottom];

    const dow = now
        .toLocaleString("en-US", {weekday: "short"})
        .toUpperCase();
    const monthAbbr = now
        .toLocaleString("en-US", {month: "short"})
        .toUpperCase();

    {
        const [dl, dt, dr, db] = dowArea;
        const stripeH = db - dt;

        const dowBox = [dl + 4, dt + 4, dr - 4, dt + stripeH * 0.55];
        const monthBox = [dl + 4, dowBox[3] + 2, dr - 4, db - 4];

        const drawVertical = (text, box, maxSize, minSize) => {
            const [bxL, bxT, bxR, bxB] = box;
            const boxW = bxR - bxL;
            const boxH = bxB - bxT;

            const {font, w, h} = fitTextInBox(
                ctx,
                text,
                [0, 0, boxH - 4, boxW - 4],
                maxSize,
                minSize
            );

            ctx.save();
            ctx.font = font;
            ctx.textBaseline = "top";
            ctx.textAlign = "left";

            const cx = bxL + boxW / 2;
            const cy = bxT + boxH / 2;

            ctx.translate(cx, cy);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(text, -w / 2, -h / 2);
            ctx.restore();
        };

        drawVertical(dow, dowBox, 40, 18);
        drawVertical(monthAbbr, monthBox, 32, 14);
    }

    const [raL, raT, raR, raB] = rightArea;
    const dayOuterBox = [raL + 4, raT + 8, raR - 4, raB - 8];
    const dayBox = [
        dayOuterBox[0],
        dayOuterBox[1] + 6,
        dayOuterBox[2],
        dayOuterBox[3] - 6,
    ];

    const dayNum = now.getDate();
    const dayStr = String(dayNum);
    const daySuffix = ordinalSuffix(dayNum);

    {
        const {font} = fitTextInBox(ctx, dayStr, dayBox, 140, 60);
        ctx.font = font;

        const {w, h} = textSize(ctx, dayStr);

        const boxCenterX = (dayBox[0] + dayBox[2]) / 2;
        const textCenterX = dayBox[0] + (boxCenterX - dayBox[0]) * 0.8;
        const dayX = textCenterX - w / 2 - 10;

        const bottomMargin = 4;
        const lift = 10;
        const dayY = dayBox[3] - h - bottomMargin - lift;

        ctx.fillText(dayStr, dayX, dayY);

        const match = /(\d+)px/.exec(font);
        const baseSize = match ? parseInt(match[1], 10) : 24;
        const suffixSize = Math.max(10, Math.floor(baseSize * 0.3));
        ctx.font = fontSpec(suffixSize);

        const {w: sW, h: sH} = textSize(ctx, daySuffix);
        let suffixX = dayX + w + 4;
        let suffixY = dayY + 4;

        if (suffixX + sW > dayBox[2] - 2) {
            suffixX = dayBox[2] - sW - 2;
        }
        if (suffixY + sH > dayBox[3] - 2) {
            suffixY = dayBox[3] - sH - 2;
        }

        ctx.fillText(daySuffix, suffixX, suffixY);
    }

    // Appliances block in the empty bottom-right square
    const devicesBox = [locMidX, dateBoxTop, brRight, brBottom];
    drawDeviceStatusIcons(ctx, devicesBox, {washerOn, dryerOn, ovenOn});

    // ===== GRID LINES =====
    ctx.save();
    ctx.strokeStyle = "#000000";

    // thick outer + major splits
    ctx.lineWidth = 2;
    ctx.strokeRect(
        contentLeft,
        contentTop,
        contentRight - contentLeft,
        contentBottom - contentTop
    );

    ctx.beginPath();
    ctx.moveTo(splitX, contentTop);
    ctx.lineTo(splitX, contentBottom);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(contentLeft, midY);
    ctx.lineTo(contentRight, midY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(leftMidX, midY);
    ctx.lineTo(leftMidX, contentBottom);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(contentLeft, bottomMidY);
    ctx.lineTo(splitX, bottomMidY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(brLeft, locBoxBottom);
    ctx.lineTo(brRight, locBoxBottom);
    ctx.stroke();

    // Single vertical line through Location + Date + Devices
    ctx.beginPath();
    ctx.moveTo(locMidX, locBox[1]);
    ctx.lineTo(locMidX, brBottom);
    ctx.stroke();

    // thinner detail lines
    ctx.lineWidth = 1;

    if (detailRowBounds.length > 0) {
        const firstTop = detailRowBounds[0].top;
        ctx.beginPath();
        ctx.moveTo(weatherLeft, firstTop);
        ctx.lineTo(weatherRight, firstTop);
        ctx.stroke();

        for (let i = 0; i < detailRowBounds.length - 1; i++) {
            const {bottom} = detailRowBounds[i];
            ctx.beginPath();
            ctx.moveTo(weatherLeft, bottom);
            ctx.lineTo(weatherRight, bottom);
            ctx.stroke();
        }
    }

    if (locRowBounds.length > 1) {
        for (let i = 0; i < locRowBounds.length - 1; i++) {
            const {bottom} = locRowBounds[i];
            ctx.beginPath();
            ctx.moveTo(locBox[0], bottom);
            ctx.lineTo(locBox[2], bottom);
            ctx.stroke();
        }
    }

    ctx.restore();
    return canvas;
}

/**
 * Build Kobo raw buffer
 * @returns {Promise<Buffer>}
 */
export async function buildKoboRawBuffer() {
    const landscape = await buildLandscapeCanvas();
    const portrait = rotateToPortrait(landscape);
    return portrait.toBuffer("raw", {colorType: "Gray8"});
}

/**
 * Build PNG buffer
 * @param {boolean} [rotate]
 * @returns {Promise<Buffer>}
 */
export async function buildPngBuffer(rotate = true) {
    const landscape = await buildLandscapeCanvas();
    const portrait = rotate ? rotateToPortrait(landscape) : landscape;
    return portrait.toBuffer("png");
}
