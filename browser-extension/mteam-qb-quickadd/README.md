# M-Team → qBittorrent Quick Add

Chrome / Edge Manifest V3 扩展，在 M-Team 的种子列表和详情页中，向原下载按钮旁追加 **qB 下载** 按钮。

## 处理流程

1. 内容脚本只向 Service Worker 传递页面中的数字种子 ID。
2. Service Worker 用保存的 `x-api-key` 请求 `POST /api/torrent/genDlToken?id=种子ID`。
3. Service Worker 立即下载该 URL，校验响应为 bencode torrent，并限制文件不超过 20 MiB。
4. Service Worker 登录 qBittorrent `POST /api/v2/auth/login`。
5. 用 `multipart/form-data` 的 `torrents` 文件字段上传到 `POST /api/v2/torrents/add`。

M-Team API Key、qBittorrent 账号和密码不会注入 M-Team 页面，也不会写入日志。

## 安装

### Chrome

1. 打开 `chrome://extensions/`。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择本目录 `browser-extension/mteam-qb-quickadd`。

### Edge

1. 打开 `edge://extensions/`。
2. 开启「开发人员模式」。
3. 点击「加载解压缩的扩展」并选择本目录。

## 配置

1. 点击浏览器工具栏中的扩展图标，进入设置页。
2. 填写 M-Team API 地址和身份密钥。
3. 填写 qBittorrent WebUI 地址、用户名和密码。
4. 点击「保存设置」，在浏览器权限对话框中授予该 qBittorrent 主机的访问权限。
5. 点击「测试 qBittorrent」确认 Web API 连通。
6. 刷新已打开的 M-Team 页面。

## 跨域与 qBittorrent CSRF

- M-Team API 与 qBittorrent 请求由扩展 Service Worker 发出，并使用 Chrome `host_permissions` / `optional_host_permissions`，不由页面直接跨域请求。
- qBittorrent 要求 `Origin` 或 `Referer` 与 WebUI 主机一致。扩展使用限定到自身 Service Worker 发起、且只匹配已配置 qBittorrent `/api/v2/` 路径的 Manifest V3 动态 DNR 规则设置这两个请求头。
- 使用 HTTPS 且为自签证书时，需要先在浏览器中打开 WebUI 并信任该证书。
- 使用 HTTP 时，WebUI 登录信息与 SID 会以明文在网络中传输；仅用于可信局域网，优先为 qBittorrent WebUI 配置 HTTPS。
- 反向代理子路径可直接写入 WebUI 地址，例如 `https://HOST/qbittorrent`。

## 密钥存储

- 敏感字段使用 `chrome.storage.local`，不使用 `storage.sync`。
- Service Worker 将存储访问级别设为 `TRUSTED_CONTEXTS`，页面内容脚本只能发送数字种子 ID。
- 扩展不在源码中预置 API Key、qBittorrent 密码或个人主机地址。
- 本地扩展存储不是操作系统密码库；需要撤销时，在 M-Team 重置 API Key，在 qBittorrent 修改 WebUI 密码，并清除扩展数据。

## 错误提示

按钮会显示处理中、成功或错误状态，页面右上角同时显示可读错误，包括：

- M-Team API Key 缺失、API 返回错误或下载链接异常。
- qBittorrent 主机权限缺失、WebUI 连接失败、登录失败或 HTTP 403。
- M-Team 一次性链接失效，或返回的内容不是 bencode torrent。
- qBittorrent 拒绝新增任务，例如重复种子。

## API 依据

- [M-Team API Wiki](https://wiki.m-team.cc/zh-tw/api)
- [qBittorrent WebUI API 5.0](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29)
- [Chrome 扩展跨域请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Chrome declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
