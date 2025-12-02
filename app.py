#!/usr/bin/env python3
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime
from typing import Tuple, Any, Dict

import requests
from PIL import Image, ImageDraw, ImageFont

# ===== Config via environment variables =====
HA_URL = os.environ.get("HA_URL", "http://homeassistant:8123").rstrip("/")
HA_TOKEN = os.environ.get("HA_TOKEN", "")
WEATHER_ENTITY = os.environ.get("WEATHER_ENTITY", "weather.ironynet")
DL_ENTITY = os.environ.get("DL_ENTITY", "sensor.transmission_download_speed")
UL_ENTITY = os.environ.get("UL_ENTITY", "sensor.transmission_upload_speed")

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


def build_image_bytes() -> bytes:
    img = Image.new("L", (CANVAS_WIDTH, CANVAS_HEIGHT), 255)  # white background, LANDSCAPE
    draw = ImageDraw.Draw(img)

    # Fonts for fixed-size text
    cond_font = get_font(56)
    detail_font = get_font(32)
    tx_label_font = get_font(30)
    tx_value_font = get_font(28)
    small_font = get_font(20)

    margin = 24
    split_x = 420  # left/right column boundary

    # ===== Fetch data =====
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

    # Transmission
    try:
        dl_state, dl_attrs = ha_state(DL_ENTITY)
        ul_state, ul_attrs = ha_state(UL_ENTITY)
        dl_text = format_speed(dl_state, dl_attrs)
        ul_text = format_speed(ul_state, ul_attrs)
    except Exception:
        dl_text = "ERR"
        ul_text = "ERR"

    # ===== LEFT COLUMN: condition + details + transmission + updated =====
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

    # Transmission block below details
    y += 16
    draw.text((x_left, y), "Transmission:", font=tx_label_font, fill=0)
    y += tx_label_font.size + 6
    draw.text((x_left, y), f"Up: {ul_text}", font=tx_value_font, fill=0)
    y += tx_value_font.size + 4
    draw.text((x_left, y), f"Down: {dl_text}", font=tx_value_font, fill=0)

    # Updated timestamp at the very bottom-left
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    updated_text = f"Updated: {now}"
    upd_w, upd_h = text_size(draw, updated_text, small_font)
    upd_x = x_left
    upd_y = CANVAS_HEIGHT - margin - upd_h
    draw.text((upd_x, upd_y), updated_text, font=small_font, fill=0)

    # ===== RIGHT COLUMN TOP: huge temperature (dynamically sized) =====
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
    temp_box_bottom = CANVAS_HEIGHT // 2 - 10  # top half of the right side

    temp_font, temp_w, temp_h = fit_text_in_box(
        draw,
        temp_str,
        (temp_box_left, temp_box_top, temp_box_right, temp_box_bottom),
        max_size=180,
        min_size=80,
    )

    temp_cx = (temp_box_left + temp_box_right) // 2
    temp_cy = (temp_box_top + temp_box_bottom) // 2
    temp_x = temp_cx - temp_w // 2
    temp_y = temp_cy - temp_h // 2
    draw.text((temp_x, temp_y), temp_str, font=temp_font, fill=0)

    # ===== RIGHT COLUMN: big weather icon just under temp =====
    icon = icon_for_condition(condition)

    # Icon box starts a bit below the actual rendered temp glyph, and
    # stops a bit above the very bottom so it doesn't get clipped.
    icon_box_left = split_x + 10
    icon_box_top = temp_y + temp_h + 20
    icon_box_right = CANVAS_WIDTH - margin
    icon_box_bottom = CANVAS_HEIGHT - margin - 40

    # Guard in case temp eats more space than expected
    if icon_box_bottom <= icon_box_top + 20:
        icon_box_top = CANVAS_HEIGHT // 2 + 10
        icon_box_bottom = CANVAS_HEIGHT - margin - 40

    icon_font, icon_w, icon_h = fit_text_in_box(
        draw,
        icon,
        (icon_box_left, icon_box_top, icon_box_right, icon_box_bottom),
        max_size=260,  # let it get quite large
        min_size=80,
    )

    icon_cx = (icon_box_left + icon_box_right) // 2
    icon_cy = (icon_box_top + icon_box_bottom) // 2
    icon_x = icon_cx - icon_w // 2
    icon_y = icon_cy - icon_h // 2
    draw.text((icon_x, icon_y), icon, font=icon_font, fill=0)

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
