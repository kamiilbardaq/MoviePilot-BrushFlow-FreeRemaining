"use strict";

importScripts("core.js");

const {
  isMteamHost,
  permissionPatternFor,
  mteamTokenEndpoint,
  escapeRegex,
  findDownloadUrl
} = globalThis.MTQBCore;

const CONFIG_KEY = "mtqbConfig";
const QB_HEADER_RULE_ID = 91001;
let addTorrentActive = false;

const DEFAULT_CONFIG = Object.freeze({
  mteamApiBase: "https://api.m-team.cc",
  mteamApiKey: "",
  qbBaseUrl: "",
  qbUsername: "",
  qbPassword: "",
  savePath: "",
  category: "",
  tags: "",
  paused: false,
  autoTmm: false,
  sequentialDownload: false,
  firstLastPiecePrio: false,
  skipChecking: false
});

class PublicError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PublicError";
    this.code = code;
  }
}

function normalizeBaseUrl(rawValue, kind) {
  let url;
  try {
    url = new URL(String(rawValue || "").trim());
  } catch {
    throw new PublicError("INVALID_URL", `${kind} 地址格式不正确`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PublicError("INVALID_URL", `${kind} 地址仅支持 HTTP/HTTPS`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new PublicError("INVALID_URL", `${kind} 地址中不要包含账号、密码、查询参数或锚点`);
  }
  return url.href.replace(/\/$/, "");
}

function normalizeConfig(input = {}) {
  const config = { ...DEFAULT_CONFIG, ...input };
  config.mteamApiBase = normalizeBaseUrl(config.mteamApiBase, "M-Team API");
  if (!isMteamHost(new URL(config.mteamApiBase).hostname)) {
    throw new PublicError("INVALID_MTEAM_HOST", "M-Team API 地址必须使用 m-team.cc 或 m-team.io 域名");
  }

  if (config.qbBaseUrl) {
    config.qbBaseUrl = normalizeBaseUrl(config.qbBaseUrl, "qBittorrent WebUI");
  }

  for (const key of ["mteamApiKey", "qbUsername", "savePath", "category", "tags"]) {
    config[key] = String(config[key] || "").trim();
  }
  config.qbPassword = String(config.qbPassword || "");
  for (const key of ["paused", "autoTmm", "sequentialDownload", "firstLastPiecePrio", "skipChecking"]) {
    config[key] = Boolean(config[key]);
  }
  return config;
}

async function getConfig() {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  return normalizeConfig(stored[CONFIG_KEY] || DEFAULT_CONFIG);
}

function validateReadyConfig(config) {
  if (!config.mteamApiKey) {
    throw new PublicError("NEED_CONFIG", "请先在扩展设置中填写 M-Team API Key");
  }
  if (!config.qbBaseUrl || !config.qbUsername || !config.qbPassword) {
    throw new PublicError("NEED_CONFIG", "请先在扩展设置中完成 qBittorrent WebUI 配置");
  }
}

async function assertQbHostPermission(qbBaseUrl) {
  const origins = [permissionPatternFor(qbBaseUrl)];
  if (!(await chrome.permissions.contains({ origins }))) {
    throw new PublicError("QB_PERMISSION", "请在扩展设置中保存一次，授予 qBittorrent 主机访问权限");
  }
}

async function configureQbHeaderRule(qbBaseUrl) {
  const base = normalizeBaseUrl(qbBaseUrl, "qBittorrent WebUI");
  const origin = new URL(base).origin;
  const regexFilter = `^${escapeRegex(base)}/api/v2/`;
  const support = await chrome.declarativeNetRequest.isRegexSupported({ regex: regexFilter });
  if (!support.isSupported) {
    throw new PublicError("QB_RULE", "qBittorrent 请求规则生成失败");
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [QB_HEADER_RULE_ID],
    addRules: [
      {
        id: QB_HEADER_RULE_ID,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "Origin", operation: "set", value: origin },
            { header: "Referer", operation: "set", value: `${base}/` }
          ]
        },
        condition: {
          regexFilter,
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: ["xmlhttprequest"]
        }
      }
    ]
  });
}

function requireTorrentId(value) {
  const id = String(value || "").trim();
  if (!/^\d{1,20}$/.test(id)) {
    throw new PublicError("INVALID_TORRENT", "种子 ID 格式不正确");
  }
  return id;
}

function parseJsonResponse(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new PublicError("BAD_RESPONSE", `${label} 返回了非 JSON 数据`);
  }
}

function cleanRemoteMessage(value, fallback) {
  const text = String(value || "").replace(/[\r\n\t]+/g, " ").trim();
  return text ? text.slice(0, 180) : fallback;
}

async function getMteamDownloadUrl(config, torrentId) {
  const endpoint = mteamTokenEndpoint(config.mteamApiBase, torrentId);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "x-api-key": config.mteamApiKey
      },
      cache: "no-store",
      credentials: "omit",
      redirect: "error"
    });
  } catch {
    throw new PublicError("MTEAM_NETWORK", "M-Team API 连接失败，请检查 API 地址与网络");
  }

  const text = await response.text();
  if (!response.ok) {
    throw new PublicError("MTEAM_HTTP", `M-Team API 请求失败（HTTP ${response.status}）`);
  }
  const payload = parseJsonResponse(text, "M-Team API");
  if (String(payload?.code ?? "") !== "0") {
    throw new PublicError(
      "MTEAM_API",
      cleanRemoteMessage(payload?.message, "M-Team API 未生成下载链接")
    );
  }
  const downloadUrl = findDownloadUrl(payload.data);
  if (!downloadUrl || downloadUrl.length > 8192) {
    throw new PublicError("MTEAM_LINK", "M-Team API 返回的下载链接格式异常");
  }
  return downloadUrl;
}

function validateMteamDownloadUrl(downloadUrl) {
  let url;
  try {
    url = new URL(downloadUrl);
  } catch {
    throw new PublicError("MTEAM_LINK", "M-Team 下载链接格式异常");
  }
  if (!isMteamHost(url.hostname)) {
    throw new PublicError("MTEAM_LINK_HOST", "M-Team 下载链接使用了未预期的主机");
  }
  if (url.protocol !== "https:") {
    throw new PublicError("MTEAM_LINK_PROTOCOL", "M-Team 下载链接未使用 HTTPS");
  }
  return url.href;
}

function qbEndpoint(config, path) {
  return `${config.qbBaseUrl}/api/v2/${path}`;
}

async function qbFetch(config, path, init) {
  try {
    return await fetch(qbEndpoint(config, path), {
      ...init,
      credentials: "include",
      cache: "no-store",
      redirect: "error"
    });
  } catch {
    throw new PublicError("QB_NETWORK", "qBittorrent WebUI 连接失败，请检查地址、证书和局域网连通性");
  }
}

async function loginQb(config) {
  const response = await qbFetch(config, "auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({
      username: config.qbUsername,
      password: config.qbPassword
    })
  });
  const text = (await response.text()).trim();
  if (response.status === 403) {
    throw new PublicError("QB_FORBIDDEN", "qBittorrent 拒绝了登录（HTTP 403），请检查 WebUI 地址、反向代理与登录失败封禁状态");
  }
  if (!response.ok || text !== "Ok.") {
    throw new PublicError("QB_LOGIN", "qBittorrent 登录失败，请检查账号和密码");
  }
}

async function verifyQbSession(config) {
  const response = await qbFetch(config, "app/version", { method: "GET" });
  const version = (await response.text()).trim();
  if (!response.ok) {
    throw new PublicError(
      "QB_SESSION",
      `qBittorrent 会话校验失败（HTTP ${response.status}），请检查浏览器 Cookie 设置`
    );
  }
  return version;
}

async function prepareQb(config) {
  await assertQbHostPermission(config.qbBaseUrl);
  await configureQbHeaderRule(config.qbBaseUrl);
  await loginQb(config);
  return verifyQbSession(config);
}

async function addTorrentUrlToQb(config, downloadUrl, temporaryTag) {
  const form = new FormData();
  form.append("urls", validateMteamDownloadUrl(downloadUrl));
  if (config.savePath) form.append("savepath", config.savePath);
  if (config.category) form.append("category", config.category);
  form.append("tags", [config.tags, temporaryTag].filter(Boolean).join(","));
  if (config.paused) form.append("paused", "true");
  if (config.autoTmm) form.append("autoTMM", "true");
  if (config.sequentialDownload) form.append("sequentialDownload", "true");
  if (config.firstLastPiecePrio) form.append("firstLastPiecePrio", "true");
  if (config.skipChecking) form.append("skip_checking", "true");

  const response = await qbFetch(config, "torrents/add", {
    method: "POST",
    body: form
  });
  const text = (await response.text()).trim();
  if (!response.ok) {
    throw new PublicError("QB_ADD_HTTP", `qBittorrent 新增任务失败（HTTP ${response.status}）`);
  }
  if (/^fails?\.?$/i.test(text)) {
    throw new PublicError("QB_ADD", "qBittorrent 未接收该任务，种子可能已存在或下载链接已失效");
  }
  if (text !== "Ok.") {
    throw new PublicError("QB_ADD", `qBittorrent 返回异常：${cleanRemoteMessage(text, "未知响应")}`);
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function removeTemporaryTag(config, hashes, temporaryTag) {
  if (!hashes.length) return;
  const response = await qbFetch(config, "torrents/removeTags", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({
      hashes: hashes.join("|"),
      tags: temporaryTag
    })
  });
  if (!response.ok) {
    throw new PublicError("QB_TAG_CLEANUP", `qBittorrent 临时标签清理失败（HTTP ${response.status}）`);
  }
  const deleteResponse = await qbFetch(config, "torrents/deleteTags", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ tags: temporaryTag })
  });
  if (!deleteResponse.ok) {
    throw new PublicError("QB_TAG_CLEANUP", `qBittorrent 临时标签删除失败（HTTP ${deleteResponse.status}）`);
  }
}

async function getTorrentsByTag(config, temporaryTag) {
  const path = `torrents/info?tag=${encodeURIComponent(temporaryTag)}`;
  const response = await qbFetch(config, path, { method: "GET" });
  const text = await response.text();
  if (!response.ok) {
    throw new PublicError("QB_CONFIRM", `qBittorrent 任务确认失败（HTTP ${response.status}）`);
  }
  const torrents = parseJsonResponse(text, "qBittorrent");
  return Array.isArray(torrents) ? torrents : [];
}

async function waitForAddedTorrent(config, temporaryTag) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const torrents = await getTorrentsByTag(config, temporaryTag);
    if (torrents.length) {
      await wait(2500);
      const settledTorrents = await getTorrentsByTag(config, temporaryTag).catch(() => torrents);
      const confirmedTorrents = settledTorrents.length ? settledTorrents : torrents;
      const hashes = confirmedTorrents
        .map((torrent) => String(torrent?.hash || ""))
        .filter((hash) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(hash));
      await removeTemporaryTag(config, hashes, temporaryTag).catch(() => undefined);
      return confirmedTorrents[0];
    }
    await wait(1000);
  }
  throw new PublicError(
    "QB_CONFIRM_TIMEOUT",
    "下载链接已提交，但 qBittorrent 在 15 秒内没有生成任务，请检查 qB 日志、网络和保存路径"
  );
}

async function addTorrent(message, sender) {
  let senderUrl;
  try {
    senderUrl = new URL(sender.url || "");
  } catch {
    throw new PublicError("UNTRUSTED_SENDER", "请从 M-Team 页面使用此按钮");
  }
  if (!isMteamHost(senderUrl.hostname)) {
    throw new PublicError("UNTRUSTED_SENDER", "请从 M-Team 页面使用此按钮");
  }

  if (addTorrentActive) {
    throw new PublicError("BUSY", "已有种子正在发送，请稍候");
  }

  const torrentId = requireTorrentId(message.torrentId);
  addTorrentActive = true;
  try {
    const config = await getConfig();
    validateReadyConfig(config);
    const downloadUrl = await getMteamDownloadUrl(config, torrentId);
    await prepareQb(config);
    const temporaryTag = `mtqb-${torrentId}-${crypto.randomUUID().slice(0, 8)}`;
    await addTorrentUrlToQb(config, downloadUrl, temporaryTag);
    const torrent = await waitForAddedTorrent(config, temporaryTag);
    const name = cleanRemoteMessage(torrent?.name, `种子 ${torrentId}`);
    const state = String(torrent?.state || "");
    const stateHint = state === "error" ? "，但任务状态为 error，请检查 qB 保存路径权限" : "";
    return { message: `${name} 已进入 qBittorrent${stateHint}` };
  } finally {
    addTorrentActive = false;
  }
}

function isExtensionPage(sender) {
  return typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));
}

async function testQb(sender) {
  if (!isExtensionPage(sender)) {
    throw new PublicError("UNTRUSTED_SENDER", "请从扩展设置页测试连接");
  }
  const config = await getConfig();
  validateReadyConfig(config);
  const version = await prepareQb(config);
  return { message: `qBittorrent 连接成功，版本 ${version || "unknown"}` };
}

async function configUpdated(sender) {
  if (!isExtensionPage(sender)) {
    throw new PublicError("UNTRUSTED_SENDER", "设置更新请求来源异常");
  }
  const config = await getConfig();
  if (config.qbBaseUrl) {
    await assertQbHostPermission(config.qbBaseUrl);
    await configureQbHeaderRule(config.qbBaseUrl);
  }
  return { message: "设置已生效" };
}

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== "string") {
    throw new PublicError("BAD_MESSAGE", "请求格式不正确");
  }
  switch (message.type) {
    case "MTQB_ADD_TORRENT":
      return addTorrent(message, sender);
    case "MTQB_TEST_QB":
      return testQb(sender);
    case "MTQB_CONFIG_UPDATED":
      return configUpdated(sender);
    default:
      throw new PublicError("BAD_MESSAGE", "未知扩展请求");
  }
}

function publicFailure(error) {
  if (error instanceof PublicError) {
    return { ok: false, code: error.code, error: error.message };
  }
  console.error("M-Team qB extension internal error", error?.name || "Error");
  return { ok: false, code: "INTERNAL", error: "扩展内部错误，请打开扩展设置重试" };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse(publicFailure(error)));
  return true;
});

async function restrictStorageAccess() {
  if (chrome.storage.local.setAccessLevel) {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  restrictStorageAccess().catch(() => undefined);
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(() => {
  restrictStorageAccess().catch(() => undefined);
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !Object.hasOwn(changes, CONFIG_KEY)) return;
  if (changes[CONFIG_KEY].newValue) return;
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [QB_HEADER_RULE_ID]
  }).catch(() => undefined);
});

restrictStorageAccess().catch(() => undefined);
