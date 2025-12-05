// haClient.js
// Home Assistant websocket + cached state helpers

import WebSocket from "ws";
import {HA_URL, HA_TOKEN, HA_HEADERS} from "../config.js";

const stateCache = new Map(); // entity_id -> { state, attributes }
let cacheReady = false;

let ws = null;
let wsConnected = false;
let wsAuthOk = false;
let wsIdCounter = 1;
let wsReconnectTimer = null;

// Build ws:// or wss:// URL from HA_URL
const HA_WS_URL = (() => {
    try {
        const url = new URL(HA_URL);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.pathname = "/api/websocket";
        url.search = "";
        return url.toString();
    } catch {
        return HA_URL.replace(/^http/, "ws") + "/api/websocket";
    }
})();

function setCacheFromStatesArray(arr) {
    stateCache.clear();
    for (const s of arr || []) {
        if (!s || !s.entity_id) continue;
        stateCache.set(s.entity_id, {
            state: s.state,
            attributes: s.attributes || {},
        });
    }
    if (stateCache.size > 0) cacheReady = true;
}

async function seedStatesFromRest() {
    try {
        const res = await fetch(`${HA_URL}/api/states`, {headers: HA_HEADERS});
        if (!res.ok) throw new Error(`HA /api/states HTTP ${res.status}`);
        const all = await res.json();
        setCacheFromStatesArray(all);
        console.log(
            `[kobo-dashboard] Seeded ${stateCache.size} HA states from REST`
        );
    } catch (e) {
        console.error("[kobo-dashboard] Error seeding HA state cache:", e.message);
    }
}

function sendWs(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

function subscribeStateChanged() {
    const id = wsIdCounter++;
    sendWs({
        id,
        type: "subscribe_events",
        event_type: "state_changed",
    });
}

function scheduleReconnect() {
    if (wsReconnectTimer) return;
    wsReconnectTimer = setTimeout(() => {
        wsReconnectTimer = null;
        connectWebSocket();
    }, 5000);
}

function handleWsMessage(data) {
    let msg;
    try {
        msg = JSON.parse(data.toString());
    } catch {
        return;
    }

    if (msg.type === "auth_required") {
        sendWs({type: "auth", access_token: HA_TOKEN});
        return;
    }

    if (msg.type === "auth_ok") {
        wsAuthOk = true;
        console.log("[kobo-dashboard] HA websocket auth_ok");
        seedStatesFromRest().then(() => {
            subscribeStateChanged();
        });
        return;
    }

    if (msg.type === "auth_invalid") {
        wsAuthOk = false;
        console.error(
            "[kobo-dashboard] HA websocket auth_invalid:",
            msg.message || ""
        );
        try {
            ws.close();
        } catch {
            /* ignore */
        }
        return;
    }

    if (msg.type === "event" && msg.event?.event_type === "state_changed") {
        const newState = msg.event.data?.new_state;
        if (newState && newState.entity_id) {
            stateCache.set(newState.entity_id, {
                state: newState.state,
                attributes: newState.attributes || {},
            });
            cacheReady = true;
        }
    }
}

function connectWebSocket() {
    if (!HA_TOKEN) {
        console.warn(
            "[kobo-dashboard] HA_TOKEN not set; WebSocket live cache disabled (REST-only)."
        );
        return;
    }

    try {
        console.log("[kobo-dashboard] Connecting to HA websocket:", HA_WS_URL);
        ws = new WebSocket(HA_WS_URL);

        ws.on("open", () => {
            wsConnected = true;
            wsAuthOk = false;
            console.log("[kobo-dashboard] HA websocket open");
        });

        ws.on("message", handleWsMessage);

        ws.on("close", (code, reason) => {
            wsConnected = false;
            wsAuthOk = false;
            console.warn(
                `[kobo-dashboard] HA websocket closed (${code}): ${
                    reason?.toString() || ""
                }`
            );
            scheduleReconnect();
        });

        ws.on("error", (err) => {
            console.error("[kobo-dashboard] HA websocket error:", err.message);
            // close event will schedule reconnect
        });
    } catch (e) {
        console.error("[kobo-dashboard] Failed to create HA websocket:", e.message);
        scheduleReconnect();
    }
}

// Call this once from app.js
export function initHomeAssistant() {
    connectWebSocket();
    seedStatesFromRest().catch((e) =>
        console.error(
            `[kobo-dashboard] Something went wrong seeding states: ${e?.message || ""}`
        )
    );
}

// ========= Cache + REST helpers =========

function haStateFromCache(entityId) {
    if (!entityId) return [null, {}];
    const entry = stateCache.get(entityId);
    if (!entry) return [null, {}];
    return [entry.state, entry.attributes || {}];
}

// Prefer cache; fall back to REST for cold start
export async function haState(entityId) {
    if (!entityId) return [null, {}];

    if (cacheReady) {
        return haStateFromCache(entityId);
    }

    const url = `${HA_URL}/api/states/${entityId}`;
    const res = await fetch(url, {headers: HA_HEADERS});
    if (!res.ok) throw new Error(`HA ${entityId} HTTP ${res.status}`);
    const data = await res.json();
    return [data.state, data.attributes || {}];
}

export async function numericState(entityId) {
    if (!entityId) return [null, null, {}];
    try {
        const [state, attrs] = await haState(entityId);
        if (state === "unknown" || state === "unavailable" || state == null) {
            return [null, attrs.unit_of_measurement, attrs];
        }
        const v = parseFloat(state);
        if (Number.isNaN(v)) return [null, attrs.unit_of_measurement, attrs];
        return [v, attrs.unit_of_measurement, attrs];
    } catch {
        return [null, null, {}];
    }
}

export async function stringState(entityId) {
    if (!entityId) return [null, {}];
    try {
        const [state, attrs] = await haState(entityId);
        if (state === "unknown" || state === "unavailable" || state == null) {
            return [null, attrs];
        }
        return [String(state), attrs];
    } catch {
        return [null, {}];
    }
}
