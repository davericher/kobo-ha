#!/usr/bin/env python3
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime
from typing import Tuple, Any, Dict, List

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

WIDTH, HEIGHT = 600, 800

HEADERS = {
    "Authorization": f"Bearer {HA_TOKEN}",
    "Content-Type": "application/json",
}


# ===== Helpers =====
def get_font(size: int) -> ImageFont.FreeTypeFont:
    """Try to load DejaVuSans, fall back to default bitmap font."""
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size)
    except Exception:
        return ImageFont.load_default()


def text_size(draw, text: str, font):
    """Replacement for deprecated draw.textsize using textbbox."""
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


def parse_forecast(attrs: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return first 5 daily entries with parsed datetime & temps."""
    fc = attrs.get("forecast") or []
    out = []
    for entry in fc[:5]:
        dt_raw = entry.get("datetime") or entry.get("time")
        try:
            dt = datetime.fromisoformat(dt_raw.replace("Z", "+00:00"))
        except Exception:
            dt = None
        out.append(
            {
                "dt": dt,
                "day": dt.strftime("%a") if dt else "",
                "temp": entry.get("temperature"),
                "templow": entry.get("templow") or entry.get("temperature"),
                "condition": entry.get("condition") or "",
            }
        )
    return out


def build_image_bytes() -> bytes:
    img = Image.new("L", (WIDTH, HEIGHT), 255)  # white background
    draw = ImageDraw.Draw(img)

    title_font = get_font(32)
    cond_font = get_font(28)
    big_temp_font = get_font(72)
    label_font = get_font(20)
    small_font = get_font(16)

    margin = 20

    try:
        weather_state, w_attrs = ha_state(WEATHER_ENTITY)
    except Exception as e:
        # If weather fails, just show error
        draw.text((margin, margin), "Error reading weather", font=title_font, fill=0)
        draw.text((margin, margin + 40), str(e), font=small_font, fill=0)
        return img.tobytes()

    # Current weather details
    location = w_attrs.get("friendly_name", WEATHER_ENTITY)
    condition = weather_state
    temp = w_attrs.get("temperature")
    temp_unit = w_attrs.get("temperature_unit", "°C")
    pressure = w_attrs.get("pressure")
    humidity = w_attrs.get("humidity")
    wind_speed = w_attrs.get("wind_speed")
    wind_bearing = w_attrs.get("wind_bearing")
    forecast = parse_forecast(w_attrs)

    # Transmission speeds
    try:
        dl_state, dl_attrs = ha_state(DL_ENTITY)
        ul_state, ul_attrs = ha_state(UL_ENTITY)
        dl_text = format_speed(dl_state, dl_attrs)
        ul_text = format_speed(ul_state, ul_attrs)
    except Exception:
        dl_text = "ERR"
        ul_text = "ERR"

    # ===== Layout =====
    y = margin

    # Header: location
    draw.text((margin, y), location, font=title_font, fill=0)

    # Right side: DL/UL small panel
    tx_label = "Transmission"
    tx_w, _ = text_size(draw, tx_label, label_font)
    tx_x = WIDTH - margin - tx_w
    draw.text((tx_x, y), tx_label, font=label_font, fill=0)
    y_tx = y + label_font.size + 4
    draw.text((tx_x, y_tx), f"DL: {dl_text}", font=small_font, fill=0)
    y_tx += small_font.size + 2
    draw.text((tx_x, y_tx), f"UL: {ul_text}", font=small_font, fill=0)

    y += title_font.size + 10

    # Condition + icon
    icon = icon_for_condition(condition)
    icon_font = get_font(48)

    cond_text = condition.capitalize()
    draw.text((margin, y), cond_text, font=cond_font, fill=0)

    icon_w, icon_h = text_size(draw, icon, icon_font)
    draw.text(
        (margin, y + cond_font.size + 5),
        icon,
        font=icon_font,
        fill=0,
    )

    # Big current temperature on the right
    temp_str = "—"
    if temp is not None:
        try:
            temp_str = f"{float(temp):.0f}{temp_unit}"
        except Exception:
            temp_str = f"{temp}{temp_unit}"

    tw, th = text_size(draw, temp_str, big_temp_font)
    temp_x = WIDTH - margin - tw
    temp_y = y + 10
    draw.text((temp_x, temp_y), temp_str, font=big_temp_font, fill=0)

    # Meta line: updated time
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    y_meta = temp_y + th + 5
    draw.text((margin, y_meta), f"Updated: {now}", font=small_font, fill=0)

    # Details: pressure / humidity / wind
    y_details = y_meta + small_font.size + 10
    if pressure is not None:
        draw.text(
            (margin, y_details),
            f"Pressure: {pressure} hPa",
            font=label_font,
            fill=0,
        )
        y_details += label_font.size + 4
    if humidity is not None:
        draw.text(
            (margin, y_details),
            f"Humidity: {humidity}%",
            font=label_font,
            fill=0,
        )
        y_details += label_font.size + 4
    if wind_speed is not None:
        try:
            ws_val = float(wind_speed)
            ws = f"{ws_val:.1f} m/s"
        except Exception:
            ws = f"{wind_speed} m/s"
        bearing = f" ({wind_bearing})" if wind_bearing else ""
        draw.text(
            (margin, y_details),
            f"Wind: {ws}{bearing}",
            font=label_font,
            fill=0,
        )

    # Bottom forecast strip
    if forecast:
        base_y = HEIGHT - 180
        draw.line((margin, base_y - 10, WIDTH - margin, base_y - 10), fill=0)
        draw.text((margin, base_y - 28), "Daily forecast", font=label_font, fill=0)

        col_width = (WIDTH - 2 * margin) / max(1, len(forecast))
        for i, entry in enumerate(forecast):
            x_center = margin + col_width * (i + 0.5)
            day = entry["day"]
            hi = entry["temp"]
            lo = entry["templow"]
            cond = entry["condition"]
            icon_small = icon_for_condition(cond)

            # Day name
            text = day
            w, h = text_size(draw, text, small_font)
            draw.text((x_center - w / 2, base_y), text, font=small_font, fill=0)

            # Icon
            w, h = text_size(draw, icon_small, small_font)
            draw.text((x_center - w / 2, base_y + h + 2), icon_small, font=small_font, fill=0)

            # Hi / lo
            if isinstance(hi, (int, float)):
                hi_str = f"{hi:.0f}"
            else:
                hi_str = str(hi)
            if isinstance(lo, (int, float)):
                lo_str = f"{lo:.0f}"
            else:
                lo_str = str(lo)

            hi_lo = f"{hi_str}/{lo_str}"
            w, h2 = text_size(draw, hi_lo, small_font)
            draw.text((x_center - w / 2, base_y + h + h2 + 6), hi_lo, font=small_font, fill=0)

    return img.tobytes()


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
    print(f"Serving Kobo dashboard on {BIND_HOST}:{BIND_PORT}/kobo-dashboard.raw")
    server.serve_forever()


if __name__ == "__main__":
    main()
