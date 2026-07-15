"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isMteamHost,
  normalizeHttpBaseUrl,
  permissionPatternFor,
  mteamTokenEndpoint,
  escapeRegex,
  findDownloadUrl,
  torrentIdFromUrl,
  isTorrentPayload
} = require("../core.js");

test("M-Team 主机匹配不接受伪造后缀", () => {
  assert.equal(isMteamHost("m-team.cc"), true);
  assert.equal(isMteamHost("api.m-team.cc"), true);
  assert.equal(isMteamHost("KP.M-TEAM.IO"), true);
  assert.equal(isMteamHost("m-team.cc.example.org"), false);
  assert.equal(isMteamHost("evil-m-team.cc"), false);
});

test("基础 URL 规范化与主机权限不携带端口", () => {
  assert.equal(normalizeHttpBaseUrl("http://192.0.2.10:8085/"), "http://192.0.2.10:8085");
  assert.equal(permissionPatternFor("http://192.0.2.10:8085/qb"), "http://192.0.2.10/*");
  assert.throws(() => normalizeHttpBaseUrl("file:///tmp/qb"), /URL_PROTOCOL/);
  assert.throws(() => normalizeHttpBaseUrl("https://user:pass@example.test"), /URL_COMPONENT/);
});

test("DNR 规则转义 qB URL", () => {
  assert.equal(
    escapeRegex("http://192.0.2.10:8085/qb"),
    "http://192\\.0\\.2\\.10:8085/qb"
  );
});

test("genDlToken 使用 POST 接口要求的 id 查询参数", () => {
  assert.equal(
    mteamTokenEndpoint("https://api.m-team.cc/", "1206597"),
    "https://api.m-team.cc/api/torrent/genDlToken?id=1206597"
  );
});

test("提取 genDlToken 的嵌套 HTTPS URL", () => {
  assert.equal(
    findDownloadUrl({ data: { downloadUrl: "https://api.m-team.cc/api/torrent/dl?credential=TOKEN" } }),
    "https://api.m-team.cc/api/torrent/dl?credential=TOKEN"
  );
  assert.equal(findDownloadUrl({ data: "javascript:alert(1)" }), "");
});

test("从列表链接和详情页提取数字 torrent id", () => {
  assert.equal(torrentIdFromUrl("/detail/123456", "https://kp.m-team.cc/browse"), "123456");
  assert.equal(torrentIdFromUrl("https://kp.m-team.cc/torrent?id=9988"), "9988");
  assert.equal(torrentIdFromUrl("https://kp.m-team.cc/detail/not-a-number"), "");
});

test("区分 bencode torrent 与 HTML 错误页", () => {
  const torrent = new TextEncoder().encode("d8:announce13:https://t.test4:infod4:name4:testee");
  const html = new TextEncoder().encode("<!doctype html><title>error</title>");
  assert.equal(isTorrentPayload(torrent), true);
  assert.equal(isTorrentPayload(html), false);
});
