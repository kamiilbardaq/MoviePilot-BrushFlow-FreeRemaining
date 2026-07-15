"use strict";

const { normalizeHttpBaseUrl, permissionPatternFor } = globalThis.MTQBCore;

const CONFIG_KEY = "mtqbConfig";
const DEFAULT_CONFIG = {
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
};

const fields = {
  mteamApiBase: document.querySelector("#mteam-api-base"),
  mteamApiKey: document.querySelector("#mteam-api-key"),
  qbBaseUrl: document.querySelector("#qb-base-url"),
  qbUsername: document.querySelector("#qb-username"),
  qbPassword: document.querySelector("#qb-password"),
  savePath: document.querySelector("#save-path"),
  category: document.querySelector("#category"),
  tags: document.querySelector("#tags"),
  paused: document.querySelector("#paused"),
  autoTmm: document.querySelector("#auto-tmm"),
  sequentialDownload: document.querySelector("#sequential"),
  firstLastPiecePrio: document.querySelector("#first-last"),
  skipChecking: document.querySelector("#skip-checking")
};

const form = document.querySelector("#settings-form");
const saveButton = document.querySelector("#save-button");
const testButton = document.querySelector("#test-button");
const status = document.querySelector("#status");

function normalizeBaseUrl(raw, label) {
  try {
    return normalizeHttpBaseUrl(raw);
  } catch (error) {
    if (error?.message === "URL_PROTOCOL") throw new Error(`${label} 地址仅支持 HTTP/HTTPS`);
    if (error?.message === "URL_COMPONENT") {
      throw new Error(`${label} 地址中不要包含账号、密码、查询参数或锚点`);
    }
    throw new Error(`${label} 地址格式不正确`);
  }
}

function readForm() {
  const config = {};
  for (const [key, element] of Object.entries(fields)) {
    config[key] = element.type === "checkbox"
      ? element.checked
      : (key === "qbPassword" ? element.value : element.value.trim());
  }
  config.mteamApiBase = normalizeBaseUrl(config.mteamApiBase, "M-Team API");
  config.qbBaseUrl = normalizeBaseUrl(config.qbBaseUrl, "qBittorrent WebUI");
  if (!config.mteamApiKey || !config.qbUsername || !config.qbPassword) {
    throw new Error("请完整填写 API Key 和 qBittorrent 登录信息");
  }
  return config;
}

function writeForm(config) {
  for (const [key, element] of Object.entries(fields)) {
    const value = config[key] ?? DEFAULT_CONFIG[key];
    if (element.type === "checkbox") element.checked = Boolean(value);
    else element.value = String(value || "");
  }
}

function setStatus(message, type = "info") {
  status.textContent = message;
  status.dataset.type = type;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) reject(new Error(runtimeError.message));
      else resolve(response);
    });
  });
}

async function saveConfig() {
  const config = readForm();
  const origins = [permissionPatternFor(config.qbBaseUrl)];
  const granted = await chrome.permissions.request({ origins });
  if (!granted) {
    throw new Error("需要 qBittorrent 主机访问权限才能发送任务");
  }
  const previous = await chrome.storage.local.get(CONFIG_KEY);
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
  const previousBase = previous[CONFIG_KEY]?.qbBaseUrl;
  if (previousBase) {
    try {
      const previousOrigin = permissionPatternFor(normalizeHttpBaseUrl(previousBase));
      if (!origins.includes(previousOrigin)) {
        await chrome.permissions.remove({ origins: [previousOrigin] });
      }
    } catch {
      // 旧配置格式异常时不影响新配置保存。
    }
  }
  const result = await sendMessage({ type: "MTQB_CONFIG_UPDATED" });
  if (!result?.ok) throw new Error(result?.error || "设置生效失败");
  return config;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  setStatus("正在保存…");
  try {
    await saveConfig();
    setStatus("设置已保存，刷新 M-Team 页面后即可使用。", "success");
  } catch (error) {
    setStatus(error?.message || "保存失败", "error");
  } finally {
    saveButton.disabled = false;
  }
});

testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  saveButton.disabled = true;
  setStatus("正在保存并测试…");
  try {
    await saveConfig();
    const result = await sendMessage({ type: "MTQB_TEST_QB" });
    if (!result?.ok) throw new Error(result?.error || "连接测试失败");
    setStatus(result.message, "success");
  } catch (error) {
    setStatus(error?.message || "连接测试失败", "error");
  } finally {
    testButton.disabled = false;
    saveButton.disabled = false;
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  writeForm({ ...DEFAULT_CONFIG, ...(stored[CONFIG_KEY] || {}) });
});
