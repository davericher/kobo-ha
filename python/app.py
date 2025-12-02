#!/usr/bin/env python3
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime
from typing import Tuple, Any, Dict
from io import BytesIO

import requests
from PIL import Image, ImageDraw, ImageFont

# ===== Config via environment variables =====
HA_URL = os.environ.get("HA_URL", "http://homeassistant:8123").rstrip("/")
HA_TOKEN = os.environ.get("HA_TOKEN", "")

WEATHER_ENTITY = os.environ.get("WEATHER_ENTITY", "weather.ironynet")
DL_ENTITY = os.environ.get("DL_ENTITY", "sensor.transmission_download_speed")
UL_ENTITY = os.environ.get("UL_ENTITY", "sensor.transmission_upload_speed")

# New: inside sensors
INSIDE_TEMP_ENTITY = os.environ.get("INSIDE_TEMP_ENTITY", "")          # e.g. sensor.living_room_temperature
INSIDE_HUMIDITY_ENTITY = os.environ.get("INSIDE_HUMIDITY_ENTITY", "")  # e.g. sensor.living_room_humidity
HOTTUB_TEMP_ENTITY = os.environ.get("HOTTUB_TEMP_ENTITY", "")          # e.g. sensor.hot_tub_temperature

BIND_HOST = os.environ.get("BIND_HOST", "0.0.0.0")
BIND_PORT = int(os.environ.get("BIND_PORT", "8080"))

# Logical canvas in LANDSCAPE. We’ll rotate it at the end to 600x800 portrait.
CANVAS_WIDTH, CANVAS_HEIGHT = 800, 600

HEADERS = {
    "Authorization": f"Bearer {HA_TOKEN}",
    "Content-Type": "application/json",
}


# ===== Helpers =====
def get_font(size: int) -> ImageFont.ImageFont:
    """Try to load DejaVuSans, fall back to default bitmap font."""
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size)
    except Exception:
        return ImageFont.load_default()


def text_size(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont):
    """Replacement for deprecated draw.textsize using textbbox."""
    if text is None:
        text = ""
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    return w, h


def ha_state(entity_id: str) -> Tuple[str, Dict[str, Any]]:
    url = f"{HA_URL}/api/states/{entity_id}"
    r = requests.get(url, headers=HEADERS, timeout=5)
    r.raise_for_status()
    data = r.json()
    return data["state"], data.get("attributes", {})


def icon_for_condition(condition: str) -> str:
    condition = (condition or "").lower()
    mapping = {
        "sunny": "☀",
        "clear": "☀",
        "clear-night": "☾",
        "cloudy": "☁",
        "partlycloudy": "⛅",
        "partly cloudy": "⛅",
        "rainy": "☂",
        "pouring": "☔",
        "snowy": "❄",
        "snowy-rainy": "❄☂",
        "hail": "☄",
        "lightning": "⚡",
        "lightning-rainy": "⛈",
        "windy": "🌀",
        "fog": "〰",
        "windy-variant": "🌀☁",
        "exceptional": "!",
    }
    for key, icon in mapping.items():
        if condition.startswith(key):
            return icon
    return "·"  # fallback dot


def format_speed(state: str, attrs: Dict[str, Any]) -> str:
    if state in ("unknown", "unavailable", None):
        return "-"
    unit = attrs.get("unit_of_measurement", "")
    try:
        value = float(state)
        return f"{value:.1f} {unit}".strip()
    except Exception:
        return f"{state} {unit}".strip()


def fit_text_in_box(
    draw: ImageDraw.ImageDraw,
    text: str,
    box: Tuple[int, int, int, int],
    max_size: int,
    min_size: int,
) -> Tuple[ImageFont.ImageFont, int, int]:
    """
    Find the largest font size between max_size and min_size
    such that `text` fits inside `box` (left, top, right, bottom).
    Returns (font, text_width, text_height).
    """
    left, top, right, bottom = box
    box_w = max(1, right - left)
    box_h = max(1, bottom - top)

    for size in range(max_size, min_size - 1, -2):
        font = get_font(size)
        w, h = text_size(draw, text, font)
        if w <= box_w and h <= box_h:
            return font, w, h

    # Fallback to min_size if nothing fit
    font = get_font(min_size)
    w, h = text_size(draw, text, font)
    return font, w, h


def numeric_state(entity_id: str):
    """
    Read a numeric sensor: returns (value_float_or_None, unit_or_None, attrs_dict)
    """
    if not entity_id:
        return None, None, {}
    try:
        state, attrs = ha_state(entity_id)
        if state in ("unknown", "unavailable", None):
            return None, attrs.get("unit_of_measurement"), attrs
        value = float(state)
        unit = attrs.get("unit_of_measurement")
        return value, unit, attrs
    except Exception:
        return None, None, {}


def draw_weather_icon(img: Image.Image,
                      draw: ImageDraw.ImageDraw,
                      box: Tuple[int, int, int, int],
                      condition: str,
                      w_attrs: Dict[str, Any]):
    """
    Try to draw a real icon image from weather.entity_picture.
    Fallback to a big text glyph based on the condition.
    `box` is (left, top, right, bottom).
    """
    left, top, right, bottom = box
    box_w = max(1, right - left)
    box_h = max(1, bottom - top)

    icon_url = w_attrs.get("entity_picture")
    if icon_url:
        if icon_url.startswith("/"):
            icon_url = f"{HA_URL}{icon_url}"
        try:
            r = requests.get(icon_url, headers=HEADERS, timeout=5)
            r.raise_for_status()
            ico = Image.open(BytesIO(r.content)).convert("L")
            # Scale to fit box while preserving aspect ratio
            ico.thumbnail((box_w, box_h), Image.LANCZOS)
            iw, ih = ico.size
            px = left + (box_w - iw) // 2
            py = top + (box_h - ih) // 2
            img.paste(ico, (px, py))
            return
        except Exception:
            # Fall back to glyph on any error
            pass

    # Fallback: big unicode glyph
    glyph = icon_for_condition(condition)
    font, tw, th = fit_text_in_box(draw, glyph, box, max_size=260, min_size=80)
    cx = (left + right) // 2
    cy = (top + bottom) // 2
    x = cx - tw // 2
    y = cy - th // 2
    draw.text((x, y), glyph, font=font, fill=0)


def build_image_bytes() -> bytes:
    img = Image.new("L", (CANVAS_WIDTH, CANVAS_HEIGHT), 255)  # white background, LANDSCAPE
    draw = ImageDraw.Draw(img)

    # Fonts for fixed-size text
    cond_font = get_font(56)
    detail_font = get_font(32)
    tx_label_font = get_font(26)
    tx_value_font = get_font(24)
    small_font = get_font(20)

    margin = 24
    split_x = 420  # left/right column boundary
    left_col_right = split_x - 10
    left_inner_width = left_col_right - margin
    left_mid_split = margin + left_inner_width // 2

    # ===== Fetch weather data =====
    try:
        weather_state, w_attrs = ha_state(WEATHER_ENTITY)
    except Exception as e:
        draw.text((margin, margin), "Error reading weather", font=detail_font, fill=0)
        draw.text((margin, margin + 40), str(e), font=small_font, fill=0)
        rotated_err = img.rotate(-90, expand=True)  # rotate so USB is on the right
        return rotated_err.tobytes()

    condition = weather_state
    temp = w_attrs.get("temperature")
    temp_unit = w_attrs.get("temperature_unit", "°C")

    humidity = w_attrs.get("humidity")
    pressure = w_attrs.get("pressure")
    wind_speed = w_attrs.get("wind_speed") or w_attrs.get("native_wind_speed")
    wind_speed_unit = (
        w_attrs.get("wind_speed_unit") or w_attrs.get("native_wind_speed_unit") or "m/s"
    )
    wind_bearing = w_attrs.get("wind_bearing")
    cloud_coverage = w_attrs.get("cloud_coverage")
    uv_index = w_attrs.get("uv_index")

    # Optional "feels like" / wind chill
    wind_chill_value = None
    for key in ("apparent_temperature", "wind_chill", "windchill", "feels_like", "apparent_temp"):
        v = w_attrs.get(key)
        if v not in (None, "unknown", "unavailable"):
            try:
                wind_chill_value = float(v)
                break
            except Exception:
                continue

    # Transmission
    try:
        dl_state, dl_attrs = ha_state(DL_ENTITY)
        ul_state, ul_attrs = ha_state(UL_ENTITY)
        dl_text = format_speed(dl_state, dl_attrs)
        ul_text = format_speed(ul_state, ul_attrs)
    except Exception:
        dl_text = "ERR"
        ul_text = "ERR"

    # Inside sensors
    inside_temp_val, inside_temp_unit, _ = numeric_state(INSIDE_TEMP_ENTITY)
    inside_hum_val, inside_hum_unit, _ = numeric_state(INSIDE_HUMIDITY_ENTITY)
    hottub_temp_val, hottub_temp_unit, _ = numeric_state(HOTTUB_TEMP_ENTITY)

    # ===== LEFT COLUMN TOP: weather summary =====
    x_left = margin
    y = margin

    # Condition, big
    cond_text = condition.capitalize()
    draw.text((x_left, y), cond_text, font=cond_font, fill=0)
    y += cond_font.size + 16

    def add_detail(label: str, value: str):
        nonlocal y
        text = f"{label}: {value}"
        draw.text((x_left, y), text, font=detail_font, fill=0)
        y += detail_font.size + 8

    if humidity is not None:
        add_detail("Humidity", f"{humidity}%")

    if pressure is not None:
        add_detail("Pressure", f"{pressure} hPa")

    if wind_speed is not None:
        try:
            ws_val = float(wind_speed)
            ws_str = f"{ws_val:.1f} {wind_speed_unit}"
        except Exception:
            ws_str = f"{wind_speed} {wind_speed_unit}"
        bearing = f" ({wind_bearing})" if wind_bearing else ""
        add_detail("Wind", f"{ws_str}{bearing}")

    if cloud_coverage is not None:
        add_detail("Clouds", f"{cloud_coverage}%")

    if uv_index is not None:
        add_detail("UV Index", str(uv_index))

    weather_block_bottom = y  # we'll start the inside rows below this

    # ===== LEFT COLUMN MIDDLE: inside temp + hot tub temp =====
    inside_row_top = max(weather_block_bottom + 12, int(CANVAS_HEIGHT * 0.45))
    inside_row_bottom = inside_row_top + 90
    if inside_row_bottom > CANVAS_HEIGHT - 160:
        inside_row_bottom = CANVAS_HEIGHT - 160
        inside_row_top = inside_row_bottom - 90

    # Inside temp (left mid)
    label_font = small_font

    # Inside temp text
    if inside_temp_val is not None:
        unit = inside_temp_unit or "°C"
        inside_temp_text = f"{inside_temp_val:.1f}{unit}"
    else:
        inside_temp_text = "—"

    box_inside_left = (margin, inside_row_top, left_mid_split - 5, inside_row_bottom)
    # label
    draw.text((box_inside_left[0], box_inside_left[1] + 2), "Inside Temp", font=label_font, fill=0)
    value_box_inside_left = (
        box_inside_left[0],
        box_inside_left[1] + label_font.size + 4,
        box_inside_left[2],
        box_inside_left[3] - 4,
    )
    font_inside, w_inside, h_inside = fit_text_in_box(
        draw, inside_temp_text, value_box_inside_left, max_size=70, min_size=32
    )
    cx = (value_box_inside_left[0] + value_box_inside_left[2]) // 2
    cy = (value_box_inside_left[1] + value_box_inside_left[3]) // 2
    draw.text((cx - w_inside // 2, cy - h_inside // 2), inside_temp_text, font=font_inside, fill=0)

    # Hot tub temp (right mid)
    if hottub_temp_val is not None:
        unit = hottub_temp_unit or "°C"
        hottub_temp_text = f"{hottub_temp_val:.1f}{unit}"
    else:
        hottub_temp_text = "—"

    box_hottub = (left_mid_split + 5, inside_row_top, left_col_right, inside_row_bottom)
    draw.text((box_hottub[0], box_hottub[1] + 2), "Hot Tub Temp", font=label_font, fill=0)
    value_box_hottub = (
        box_hottub[0],
        box_hottub[1] + label_font.size + 4,
        box_hottub[2],
        box_hottub[3] - 4,
    )
    font_ht, w_ht, h_ht = fit_text_in_box(
        draw, hottub_temp_text, value_box_hottub, max_size=70, min_size=32
    )
    cx_ht = (value_box_hottub[0] + value_box_hottub[2]) // 2
    cy_ht = (value_box_hottub[1] + value_box_hottub[3]) // 2
    draw.text((cx_ht - w_ht // 2, cy_ht - h_ht // 2), hottub_temp_text, font=font_ht, fill=0)

    # ===== LEFT COLUMN BOTTOM: inside humidity + transmission =====
    humidity_row_top = inside_row_bottom + 10
    humidity_row_bottom = CANVAS_HEIGHT - margin - 45
    if humidity_row_bottom <= humidity_row_top + 20:
        humidity_row_top = CANVAS_HEIGHT - 200
        humidity_row_bottom = CANVAS_HEIGHT - margin - 45

    # Inside humidity (bottom-left)
    if inside_hum_val is not None:
        hum_text = f"{inside_hum_val:.0f}%"
    else:
        hum_text = "--"

    box_hum = (margin, humidity_row_top, left_mid_split - 5, humidity_row_bottom)
    draw.text((box_hum[0], box_hum[1] + 2), "Inside Humidity", font=label_font, fill=0)
    value_box_hum = (
        box_hum[0],
        box_hum[1] + label_font.size + 4,
        box_hum[2],
        box_hum[3] - 4,
    )
    font_hum, w_hum, h_hum = fit_text_in_box(
        draw, hum_text, value_box_hum, max_size=80, min_size=32
    )
    cx_hum = (value_box_hum[0] + value_box_hum[2]) // 2
    cy_hum = (value_box_hum[1] + value_box_hum[3]) // 2
    draw.text((cx_hum - w_hum // 2, cy_hum - h_hum // 2), hum_text, font=font_hum, fill=0)

    # Transmission (bottom-right of left column)
    box_tx = (left_mid_split + 5, humidity_row_top, left_col_right, humidity_row_bottom)
    tx_cx = (box_tx[0] + box_tx[2]) // 2
    tx_cy = (box_tx[1] + box_tx[3]) // 2

    # layout three lines vertically centered
    total_tx_height = tx_label_font.size + tx_value_font.size * 2 + 10
    start_y = tx_cy - total_tx_height // 2

    draw.text(
        (box_tx[0], start_y),
        "Transmission",
        font=tx_label_font,
        fill=0,
    )
    y_line = start_y + tx_label_font.size + 4
    draw.text((box_tx[0], y_line), f"Up:   {ul_text}", font=tx_value_font, fill=0)
    y_line += tx_value_font.size + 2
    draw.text((box_tx[0], y_line), f"Down: {dl_text}", font=tx_value_font, fill=0)

    # Updated timestamp at the very bottom-left
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    updated_text = f"Updated: {now}"
    upd_w, upd_h = text_size(draw, updated_text, small_font)
    upd_x = margin
    upd_y = CANVAS_HEIGHT - margin - upd_h
    draw.text((upd_x, upd_y), updated_text, font=small_font, fill=0)

    # ===== RIGHT COLUMN TOP: huge outside temperature (dynamically sized) =====
    if temp is not None:
        try:
            temp_str = f"{float(temp):.0f}{temp_unit}"
        except Exception:
            temp_str = f"{temp}{temp_unit}"
    else:
        temp_str = "—"

    temp_box_left = split_x + 10
    temp_box_top = margin
    temp_box_right = CANVAS_WIDTH - margin
    temp_box_bottom = CANVAS_HEIGHT // 2 - 20  # top half of the right side

    # Box for main temp text (leave space at bottom for wind chill)
    temp_text_box = (temp_box_left, temp_box_top, temp_box_right, temp_box_bottom - 30)

    temp_font, temp_w, temp_h = fit_text_in_box(
        draw,
        temp_str,
        temp_text_box,
        max_size=180,
        min_size=80,
    )

    temp_cx = (temp_text_box[0] + temp_text_box[2]) // 2
    temp_cy = (temp_text_box[1] + temp_text_box[3]) // 2
    temp_x = temp_cx - temp_w // 2
    temp_y = temp_cy - temp_h // 2
    draw.text((temp_x, temp_y), temp_str, font=temp_font, fill=0)

    # Optional wind chill line under temp
    if wind_chill_value is not None:
        try:
            wc_str = f"[{wind_chill_value:.0f}{temp_unit} wind chill]"
        except Exception:
            wc_str = f"[{wind_chill_value} {temp_unit} wind chill]"
        wc_font = small_font
        wc_w, wc_h = text_size(draw, wc_str, wc_font)
        wc_cx = (temp_box_left + temp_box_right) // 2
        wc_x = wc_cx - wc_w // 2
        wc_y = temp_box_bottom - wc_h - 4
        draw.text((wc_x, wc_y), wc_str, font=wc_font, fill=0)

    # ===== RIGHT COLUMN BOTTOM: weather icon image (or glyph) =====
    icon_box_left = split_x + 10
    icon_box_top = CANVAS_HEIGHT // 2 + 10
    icon_box_right = CANVAS_WIDTH - margin
    icon_box_bottom = CANVAS_HEIGHT - margin - 10

    draw_weather_icon(
        img,
        draw,
        (icon_box_left, icon_box_top, icon_box_right, icon_box_bottom),
        condition,
        w_attrs,
    )

    # Rotate entire landscape canvas -90° so USB is on the right in widescreen
    rotated = img.rotate(-90, expand=True)
    return rotated.tobytes()


# ===== HTTP server =====
class RawHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/kobo-dashboard.raw"):
            try:
                raw = build_image_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            except Exception as e:
                msg = f"Error: {e}"
                self.send_response(500)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(msg.encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    # Quiet logs
    def log_message(self, fmt, *args):
        return


def main():
    server = HTTPServer((BIND_HOST, BIND_PORT), RawHandler)
    print(
        f"Serving Kobo dashboard on {BIND_HOST}:{BIND_PORT}/kobo-dashboard.raw "
        f"(canvas {CANVAS_WIDTH}x{CANVAS_HEIGHT} rotated to 600x800, USB on right)"
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
