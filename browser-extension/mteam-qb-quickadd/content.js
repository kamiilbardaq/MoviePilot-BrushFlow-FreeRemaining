"use strict";

const { torrentIdFromUrl: parseTorrentIdFromUrl } = globalThis.MTQBCore;

const BUTTON_MARKER = "data-mtqb-quickadd";
const WRAPPER_MARKER = "data-mtqb-wrapper";
const ROW_SELECTORS = [
  "tr",
  "[role='row']",
  ".ant-table-row",
  ".v-data-table__tr",
  ".torrent-item",
  "[class*='torrent-row']"
];

function isVisible(element) {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}

function actionElement(element) {
  return element?.closest?.("button, a, [role='button']") || element;
}

function downloadScore(element) {
  if (!(element instanceof Element) || element.hasAttribute(BUTTON_MARKER)) return -1;
  const action = actionElement(element);
  const text = [
    action?.textContent,
    action?.getAttribute?.("title"),
    action?.getAttribute?.("aria-label"),
    action?.getAttribute?.("href"),
    action?.className,
    element.className
  ].filter(Boolean).join(" ").toLowerCase();
  let score = 0;
  if (/(^|\s)(下载|下載)(\s|$)/.test(text)) score += 8;
  if (/download|mdi-download|arrow-down/.test(text)) score += 5;
  if (action?.querySelector?.("[data-icon='download'], .mdi-download, [class*='download']")) score += 4;
  if (action?.matches?.("a[href*='/download'], a[href*='download']")) score += 5;
  if (action?.textContent?.trim() === "下载" || action?.textContent?.trim() === "下載") score += 5;
  return score;
}

function findDownloadAction(scope) {
  const selectors = [
    "button",
    "a",
    "[role='button']",
    "[data-icon='download']",
    ".mdi-download",
    "[class*='download']"
  ];
  let best = null;
  let bestScore = 0;
  for (const candidate of scope.querySelectorAll(selectors.join(","))) {
    const action = actionElement(candidate);
    if (!action || !isVisible(action)) continue;
    const score = downloadScore(candidate);
    if (score >= bestScore) {
      best = action;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function findMteamListDownloadAction(row) {
  const actionCell = row.querySelector("td:last-child, [role='cell']:last-child");
  if (!actionCell) return null;
  const scored = findDownloadAction(actionCell);
  if (scored) return scored;

  // M-Team 当前列表的原下载按钮只有自定义 SVG，没有可用于识别的文本或 aria-label。
  // 操作列顺序为收藏、下载，因此以该列最后一个可见操作元素兜底。
  const actions = [...actionCell.querySelectorAll("button, a, [role='button']")]
    .filter((element) => !element.hasAttribute(BUTTON_MARKER) && isVisible(element));
  return actions.at(-1) || null;
}

function findMteamDetailDownloadAction() {
  const actions = [...document.querySelectorAll("button, a, [role='button']")]
    .filter((element) => !element.hasAttribute(BUTTON_MARKER) && isVisible(element));
  const exactText = actions.filter((element) => /^(下载|下載)$/.test(element.textContent.trim()));
  return exactText.find((element) => element.matches(".ant-btn-primary, [class*='ant-btn-primary']"))
    || exactText[0]
    || findDownloadAction(document);
}

function closestTorrentRow(anchor) {
  for (const selector of ROW_SELECTORS) {
    const row = anchor.closest(selector);
    if (row) return row;
  }
  return null;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function showToast(message, type = "info") {
  let region = document.querySelector(".mtqb-toast-region");
  if (!region) {
    region = document.createElement("div");
    region.className = "mtqb-toast-region";
    region.setAttribute("aria-live", "polite");
    document.documentElement.append(region);
  }
  const toast = document.createElement("div");
  toast.className = `mtqb-toast mtqb-toast-${type}`;
  toast.textContent = String(message || "");
  region.append(toast);
  requestAnimationFrame(() => toast.classList.add("mtqb-toast-visible"));
  setTimeout(() => {
    toast.classList.remove("mtqb-toast-visible");
    setTimeout(() => toast.remove(), 220);
  }, type === "error" ? 6500 : 3500);
}

let activeTorrentId = "";

async function onQuickAddClick(event, torrentId) {
  event.preventDefault();
  event.stopPropagation();
  if (!event.isTrusted) return;
  const button = event.currentTarget;
  if (!(button instanceof HTMLButtonElement) || button.disabled) return;
  if (activeTorrentId) {
    showToast(`种子 ${activeTorrentId} 正在处理中，请稍候`, "info");
    return;
  }
  activeTorrentId = torrentId;
  const originalText = button.textContent;
  button.disabled = true;
  button.classList.add("mtqb-loading");
  button.textContent = "…";
  try {
    const response = await sendMessage({ type: "MTQB_ADD_TORRENT", torrentId });
    if (!response?.ok) {
      throw new Error(response?.error || "发送任务失败");
    }
    button.classList.add("mtqb-success");
    button.textContent = "✓";
    showToast(response.message || "已发送到 qBittorrent", "success");
    setTimeout(() => {
      button.classList.remove("mtqb-success");
      button.textContent = originalText;
      button.disabled = false;
    }, 1800);
  } catch (error) {
    button.classList.add("mtqb-error");
    button.textContent = "!";
    showToast(error?.message || "发送任务失败", "error");
    setTimeout(() => {
      button.classList.remove("mtqb-error");
      button.textContent = originalText;
      button.disabled = false;
    }, 1800);
  } finally {
    button.classList.remove("mtqb-loading");
    activeTorrentId = "";
  }
}

function createQuickAddButton(torrentId, compact) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = compact ? "mtqb-button mtqb-button-compact" : "mtqb-button mtqb-button-detail";
  button.setAttribute(BUTTON_MARKER, "");
  button.dataset.torrentId = torrentId;
  button.title = "发送到 qBittorrent";
  button.setAttribute("aria-label", "发送到 qBittorrent");
  button.textContent = compact ? "qB" : "qB 下载";
  button.addEventListener("click", (event) => onQuickAddClick(event, torrentId));
  return button;
}

function placeAfter(reference, button) {
  if (!reference?.parentElement) return false;
  reference.insertAdjacentElement("afterend", button);
  return true;
}

function placeDetailButton(reference, button) {
  const item = reference.closest(".ant-space-item");
  if (item?.parentElement) {
    const wrapper = document.createElement(item.tagName.toLowerCase());
    wrapper.className = item.className;
    wrapper.setAttribute(WRAPPER_MARKER, "");
    wrapper.append(button);
    item.insertAdjacentElement("afterend", wrapper);
    return true;
  }
  return placeAfter(reference, button);
}

function injectListButtons() {
  const detailLinks = document.querySelectorAll("a[href*='/detail/'], a[href*='/details/'], a[href*='/torrent/']");
  const visitedRows = new Set();
  for (const anchor of detailLinks) {
    const torrentId = parseTorrentIdFromUrl(anchor.href, location.href);
    if (!torrentId) continue;
    const row = closestTorrentRow(anchor);
    if (!row || visitedRows.has(row)) continue;
    visitedRows.add(row);
    for (const staleButton of row.querySelectorAll(`[${BUTTON_MARKER}]`)) {
      if (staleButton.dataset.torrentId !== torrentId) staleButton.remove();
    }
    if (row.querySelector(`[${BUTTON_MARKER}][data-torrent-id="${CSS.escape(torrentId)}"]`)) continue;

    const originalDownload = findMteamListDownloadAction(row);
    const button = createQuickAddButton(torrentId, true);
    if (originalDownload && placeAfter(originalDownload, button)) continue;

    const fallbackCell = row.querySelector("td:last-child, [role='cell']:last-child") || row;
    fallbackCell.append(button);
  }
}

function injectDetailButton() {
  const torrentId = parseTorrentIdFromUrl(location.href, location.href);
  for (const staleButton of document.querySelectorAll(`[${BUTTON_MARKER}].mtqb-button-detail`)) {
    if (torrentId && staleButton.dataset.torrentId === torrentId) continue;
    const wrapper = staleButton.closest(`[${WRAPPER_MARKER}]`);
    if (wrapper) wrapper.remove();
    else staleButton.remove();
  }
  if (!torrentId) return;
  if (document.querySelector(`[${BUTTON_MARKER}].mtqb-button-detail[data-torrent-id="${CSS.escape(torrentId)}"]`)) return;
  const originalDownload = findMteamDetailDownloadAction();
  if (!originalDownload) return;
  placeDetailButton(originalDownload, createQuickAddButton(torrentId, false));
}

function scanPage() {
  injectListButtons();
  injectDetailButton();
}

let scanTimer = 0;
function scheduleScan() {
  if (scanTimer) return;
  scanTimer = window.setTimeout(() => {
    scanTimer = 0;
    scanPage();
  }, 160);
}

const observer = new MutationObserver(scheduleScan);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("popstate", scheduleScan);
window.addEventListener("hashchange", scheduleScan);
window.setInterval(scheduleScan, 2500);
scanPage();
