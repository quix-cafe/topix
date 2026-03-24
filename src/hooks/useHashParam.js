import { useState, useCallback, useEffect, useRef } from "react";

/**
 * Read all query params from the current URL hash.
 * Hash format: #/path?key=value&key2=value2
 */
function getHashParams() {
  const hash = window.location.hash;
  const qIdx = hash.indexOf("?");
  return qIdx === -1 ? new URLSearchParams() : new URLSearchParams(hash.slice(qIdx));
}

/**
 * Write query params back to the URL hash (replaceState — no history entry).
 */
function updateHashParams(params) {
  const hash = window.location.hash;
  const pathPart = hash.split("?")[0] || "#/play";
  const qs = params.toString();
  const newHash = pathPart + (qs ? `?${qs}` : "");
  if (window.location.hash !== newHash) {
    history.replaceState(null, "", newHash);
  }
}

/**
 * Sync a single state value with a URL hash query param.
 * Uses replaceState so filter changes don't create browser history entries.
 * Back/forward still works because tab changes use pushState.
 *
 * @param {string} key - The query param key (use tab-prefixed names to avoid collisions, e.g. "bs" for bits search)
 * @param {*} defaultValue - Default value when param is absent (determines type coercion)
 * @returns {[value, setter]} - Like useState but synced with URL
 */
export function useHashParam(key, defaultValue = "") {
  const defaultRef = useRef(defaultValue);

  const readParam = useCallback(() => {
    const raw = getHashParams().get(key);
    if (raw === null || raw === undefined) return defaultRef.current;
    // Coerce to match default type
    if (typeof defaultRef.current === "boolean") return raw === "1" || raw === "true";
    if (typeof defaultRef.current === "number") return Number(raw) || defaultRef.current;
    return raw;
  }, [key]);

  const [value, setValue] = useState(readParam);

  const set = useCallback((newValue) => {
    // Accept function updater like useState
    const resolved = typeof newValue === "function" ? newValue(value) : newValue;
    setValue(resolved);
    const params = getHashParams();
    const strVal = typeof resolved === "boolean" ? (resolved ? "1" : "") : String(resolved ?? "");
    if (strVal === "" || strVal === String(defaultRef.current)) {
      params.delete(key);
    } else {
      params.set(key, strVal);
    }
    updateHashParams(params);
  }, [key, value]);

  // Respond to popstate (back/forward)
  useEffect(() => {
    const handler = () => setValue(readParam());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [readParam]);

  return [value, set];
}

/**
 * Sync a Set with a URL hash query param (comma-separated values).
 */
export function useHashParamSet(key) {
  const readParam = useCallback(() => {
    const raw = getHashParams().get(key);
    if (!raw) return new Set();
    return new Set(raw.split(",").filter(Boolean));
  }, [key]);

  const [value, setValue] = useState(readParam);

  const set = useCallback((newValue) => {
    const resolved = typeof newValue === "function" ? newValue(value) : newValue;
    setValue(resolved);
    const params = getHashParams();
    const arr = [...resolved].filter(Boolean);
    if (arr.length === 0) {
      params.delete(key);
    } else {
      params.set(key, arr.join(","));
    }
    updateHashParams(params);
  }, [key, value]);

  useEffect(() => {
    const handler = () => setValue(readParam());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [readParam]);

  return [value, set];
}
