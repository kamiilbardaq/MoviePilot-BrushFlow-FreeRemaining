(function exposeCore(root, factory) {
  const api = factory();
  root.MTQBCore = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function createCore() {
  "use strict";

  const MTEAM_HOST_SUFFIXES = ["m-team.cc", "m-team.io"];

  function isMteamHost(hostname) {
    const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
    return MTEAM_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  }

  function normalizeHttpBaseUrl(rawValue) {
    const url = new URL(String(rawValue || "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new TypeError("URL_PROTOCOL");
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new TypeError("URL_COMPONENT");
    }
    return url.href.replace(/\/$/, "");
  }

  function permissionPatternFor(baseUrl) {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.hostname}/*`;
  }

  function mteamTokenEndpoint(apiBase, torrentId) {
    const endpoint = new URL(`${String(apiBase).replace(/\/$/, "")}/api/torrent/genDlToken`);
    endpoint.searchParams.set("id", String(torrentId));
    return endpoint.href;
  }

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function findDownloadUrl(value, depth = 0) {
    if (depth > 3 || value == null) return "";
    if (typeof value === "string") {
      const candidate = value.trim();
      try {
        const url = new URL(candidate);
        return (url.protocol === "http:" || url.protocol === "https:") ? url.href : "";
      } catch {
        return "";
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findDownloadUrl(item, depth + 1);
        if (found) return found;
      }
      return "";
    }
    if (typeof value === "object") {
      const preferredKeys = ["url", "downloadUrl", "download_url", "downloadLink", "link", "data"];
      for (const key of preferredKeys) {
        if (Object.hasOwn(value, key)) {
          const found = findDownloadUrl(value[key], depth + 1);
          if (found) return found;
        }
      }
    }
    return "";
  }

  function torrentIdFromUrl(rawUrl, baseUrl) {
    let url;
    try {
      url = new URL(rawUrl, baseUrl);
    } catch {
      return "";
    }
    const pathMatch = url.pathname.match(/\/(?:detail|details|torrent)\/(\d{1,20})(?:\/|$)/i);
    if (pathMatch) return pathMatch[1];
    const queryId = url.searchParams.get("id") || url.searchParams.get("torrentId");
    return /^\d{1,20}$/.test(queryId || "") ? queryId : "";
  }

  function containsAscii(bytes, needle) {
    outer: for (let index = 0; index <= bytes.length - needle.length; index += 1) {
      for (let offset = 0; offset < needle.length; offset += 1) {
        if (bytes[index + offset] !== needle.charCodeAt(offset)) continue outer;
      }
      return true;
    }
    return false;
  }

  function isTorrentPayload(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
    return bytes.length >= 10 && bytes[0] === 0x64 && containsAscii(bytes, "4:info");
  }

  return Object.freeze({
    isMteamHost,
    normalizeHttpBaseUrl,
    permissionPatternFor,
    mteamTokenEndpoint,
    escapeRegex,
    findDownloadUrl,
    torrentIdFromUrl,
    isTorrentPayload
  });
});
