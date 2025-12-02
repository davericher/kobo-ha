cat > ha_dashboard.sh << 'EOF'
#!/bin/sh

# ===== CONFIG =====
SERVER_IP="192.168.3.26"      # <--- change to your Unraid IP
PORT="8080"                   # <--- change if you mapped a different host port
URL="http://$SERVER_IP:$PORT/kobo-dashboard.raw"

REFRESH_SECS=300              # 5 minutes between updates
TMP_FILE="/tmp/kobo_dashboard.raw"

# Optional: kill the Kobo GUI so it doesn't redraw over our screen.
# Comment this out if you want Nickel to still run.
pkill nickel 2>/dev/null || true

while true; do
  # Fetch the image into a temp file
  if wget -q -O "$TMP_FILE" "$URL"; then
    # Draw it to the screen
    cat "$TMP_FILE" | /usr/local/Kobo/pickel showpic

    # Give the hardware a moment to finish the refresh
    sleep 1

    # Now turn off the blue blink LED
    /usr/local/Kobo/pickel blinkoff 2>/dev/null || true

    rm -f "$TMP_FILE"
    sleep "$REFRESH_SECS"
  else
    # If the fetch failed, still try to keep the LED off and retry sooner
    /usr/local/Kobo/pickel blinkoff 2>/dev/null || true
    rm -f "$TMP_FILE" 2>/dev/null || true
    sleep 30
  fi
done
EOF
