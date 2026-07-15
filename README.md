# MoviePilot BrushFlow FreeRemaining

MoviePilot V2「站点刷流（低频版）」魔改版：支持 `free_remaining`，并补齐 M-Team 普通区/Adult 全部分类白名单 API。

v4.3.4.0 新增 M-Team 36 个完整分类白名单，按 `mode=normal` / `mode=adult` 分开请求并合并去重。

上游项目：[InfinityPacer/MoviePilot-Plugins](https://github.com/InfinityPacer/MoviePilot-Plugins/tree/main/plugins.v2/brushflowlowfreq)

## 安装

1. 打开 MoviePilot V2 → **插件市场** → **自定义插件仓库**。
2. 添加仓库：

   ```text
   https://github.com/kamiilbardaq/MoviePilot-BrushFlow-FreeRemaining
   ```

3. 刷新插件市场，安装 **站点刷流（低频版·FreeRemaining）**。
4. 停用官方「站点刷流」及其他同 ID 的低频版，只运行本插件。

## 推荐配置

```text
促销：免费
最低免费剩余（小时）：24
站点时差（小时）：0
删除促销过期的未完成下载：开启
发布时间（分钟）：120
种子大小（GB）：5-80
同时下载任务数：1
执行周期：* * * * *
M-Team 分类白名单：401,419,420,421,439,403,402,438,435,404,405
```

千兆网络可把最低免费剩余设为 `12`、同时下载任务数设为 `2`；更保守可设为 `48`。

## 规则说明

- `free_remaining` 单位为小时，仅在促销选择「免费」或「2X免费」时生效。
- 剩余时间小于阈值时，插件在加入下载器之前跳过该种子。
- 日志以 `[FreeRemaining]` 开头显示当前倒计时、精确小时数、阈值及截止时间。
- 「删除促销过期的未完成下载」会在促销结束且下载未完成时删除任务及已下载文件。
- `站点时差 = MoviePilot 主机时区 - 站点显示时区`。两者相同填 `0`；主机 UTC+8、站点 UTC 填 `8`。它同时修正发布时间和无时区信息的免费截止时间。
- 发布时间或截止时间自带 `Z`、`+08:00` 等时区信息时，插件自动按绝对时间计算并忽略手动时差。
- 过期清理使用任务加入下载器时保存的促销截止时间；站点后续修改促销时长时，以保存值为准。
- 留空或 `0` 表示关闭过滤。
- 没有截止时间的免费种按长期/永久免费放行。
- 站点页面有倒计时但 MoviePilot 没有解析到 `freedate` 时，也会按无截止时间处理；可开启 DEBUG 日志核对。
- `M-Team 分类白名单` 非空时启用插件内置完整分类 API；普通区与 Adult 分类自动拆成两次请求，返回结果再按 ID 去重。
- M-Team API 返回 Unix 时间戳，M-Team 站点独立配置中的「站点时差」请保持 `0`。
- 白名单为空时沿用 MoviePilot 原生 M-Team 浏览链路；该设置对其它站点没有影响。
- M-Team 日志以 `[M-Team分类]` 开头，显示请求模式、分类 ID、返回数量和白名单保留数量。

完整文档：[插件 README](plugins.v2/brushflowlowfreq/README.md)

## M-Team → qBittorrent 浏览器扩展

仓库同时提供 Chrome / Edge Manifest V3 扩展：

- 在 M-Team 种子列表的原下载图标旁新增 **qB** 按钮。
- 在种子详情页的原「下載」按钮旁新增 **qB 下载** 按钮。
- 通过 M-Team `genDlToken` 获取一次性链接并提交给 qBittorrent Web API，由 qBittorrent 直接获取 `.torrent`。
- API Key、qBittorrent 账号和密码仅保存在本机 `chrome.storage.local`，公共源码不预置个人配置。

安装、配置及排错说明：[浏览器扩展 README](browser-extension/mteam-qb-quickadd/README.md)

## 许可证

沿用上游项目的 GPL-3.0 许可证。
