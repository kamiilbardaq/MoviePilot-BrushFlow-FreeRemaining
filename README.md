# MoviePilot BrushFlow FreeRemaining

MoviePilot V2「站点刷流（低频版）」魔改版：新增 `free_remaining`，只下载免费倒计时充足的种子。

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

完整文档：[插件 README](plugins.v2/brushflowlowfreq/README.md)

## 许可证

沿用上游项目的 GPL-3.0 许可证。
