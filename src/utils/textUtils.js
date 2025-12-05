// textUtils.js

/**
 * Title-case a string (underscores -> spaces, capitalize words)
 * @param {string} str
 * @returns {string}
 */
export function titleCase(str) {
    return String(str || "")
        .replace(/_/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
        .join(" ");
}

/**
 * Format person location state
 * @param {string|null} state
 * @returns {string}
 */
export function formatPersonLocation(state) {
    if (!state) return "—";
    const s = String(state).toLowerCase();
    if (s === "home") return "Home";
    if (s === "not_home") return "Away";
    return titleCase(state);
}

/**
 * Get ordinal suffix for number
 * @param {number} n
 * @returns {string}
 */
export function ordinalSuffix(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return "th";
    switch (v % 10) {
        case 1:
            return "st";
        case 2:
            return "nd";
        case 3:
            return "rd";
        default:
            return "th";
    }
}

/**
 * Format speed state with unit
 * @param {string|null} state
 * @param {object} attrs
 * @returns {string}
 */
export function formatSpeed(state, attrs) {
    if (state === "unknown" || state === "unavailable" || state == null) return "–";
    const unit = attrs?.unit_of_measurement || "";
    const n = parseFloat(state);
    if (!Number.isNaN(n)) return `${n.toFixed(1)} ${unit}`.trim();
    return `${state} ${unit}`.trim();
}
