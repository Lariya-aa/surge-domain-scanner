# Apple Podcasts 扫描记录

本文记录两次 Apple Podcasts 规则集测试遇到的问题、判断依据和最终处理办法，方便后续维护 Surge 规则时追溯。

## 范围

目标是用 `surge-domain-scan.js` 扫描 Apple Podcasts 链接，找出候选域名，并整理成可导入 Surge 的规则文件。

测试链接：

- `5 Star Nation`: `https://podcasts.apple.com/us/podcast/%E4%BE%86%E8%87%AA%E4%BA%94%E6%98%9F%E7%9A%84%E4%BD%A0-5-star-nation/id1588374223`
- `The American Roulette`: `https://podcasts.apple.com/us/podcast/%E7%BE%8E%E8%BD%AE%E7%BE%8E%E6%8D%A2-the-american-roulette/id1704770003`

最终规则文件：

- `ApplePodcasts-5StarNation.list`
- `ApplePodcasts-AmericanRoulette.list`

保留的原始扫描证据：

- `ApplePodcasts-AmericanRoulette.scanned.list`

## 使用命令

对 Apple Podcasts 页面，实际采用保守静态扫描：

```bash
node surge-domain-scan.js '<APPLE_PODCASTS_URL>' --mode suffix --depth 1 --max-urls 1 --timeout 10000
```

这里 `--max-urls 1` 很关键：只解析 Apple Podcasts 初始页面，不继续抓取页面正文里的所有外链。

## 遇到的问题

第一次宽松扫描使用了 `--depth 2 --max-urls 120`。结果集非常大，混入 Apple 站内全局链接、X/Twitter 基础设施、Intercom、Google Ads、其他播客提供商、文档命名空间和无关外链。这个结果可以作为压力测试证据，但不能直接作为单个播客的 Surge 规则。

第一次非授权联网运行只返回 `podcasts.apple.com`，并出现 `fetch failed`。这是沙箱网络限制导致的，不代表目标页面只有一个域名。随后用已授权联网方式重新运行扫描。

当前扫描器是静态提取器，会把很多 `href` 当成候选域名。Apple Podcasts 页面里常见创作者链接、支持链接、schema URL、社交链接，这些会和真正用于页面加载或播放的域名混在一起。

`5 Star Nation` 扫描出现了 `chinainfluencepod.comread` 和 `chinainfluencepod.xn--com-db9do48d124fe2e` 这类脏域名。它们更像页面文本被正则误抓出的结果，不应作为 Surge 规则。

`The American Roulette` 扫描显示原来的手写规则已经过期：旧文件引用 WavPub，但本次保守扫描发现当前相关候选域名集中在 `theamericanroulette.com`、`typlog.io`、`typlog.com`、`xyzfm.space`、`acast.com`、`fireside.fm`。

这次测试还暴露了脚本里的一个规则生成问题：`--mode suffix` 在同时发现根域名和子域名时，会输出语义重复的规则，例如 `DOMAIN-SUFFIX,theamericanroulette.com` 和 `DOMAIN,theamericanroulette.com`。脚本已修正为：如果 suffix 规则已经覆盖根域名，就移除对应的 exact domain 规则。

## 解决办法

最终 `.list` 文件不直接复制原始扫描结果。扫描输出只作为候选证据，需要人工清理明显的非运行时域名、文档命名空间和误抓结果。

`5 Star Nation` 清理策略：

- 保留 Apple 页面和媒体域名：`apple.com`、`cdn-apple.com`、`mzstatic.com`。
- 保留可能的 feed、媒体和节目相关域名：`firstory.me`、`omny.fm`、`omnycontent.com`、`ghostisland.media`、`chinainfluencepod.com`。
- 保留页面里出现的创作者或支持入口：`patreon.com`、`twitter.com`。
- 移除结构化数据命名空间和误抓域名：`schema.org`、`w3.org`、`chinainfluencepod.comread`。

`The American Roulette` 清理策略：

- 保留 Apple 页面和媒体域名：`apple.com`、`cdn-apple.com`、`mzstatic.com`。
- 保留节目、feed 和托管候选域名：`theamericanroulette.com`、`typlog.io`、`typlog.com`、`xyzfm.space`、`acast.com`、`fireside.fm`。
- 从最终规则中移除明显外链或文档域名：`schema.org`、`w3.org`、`amazon.com`、`ximalaya.com`。
- 保留 `ApplePodcasts-AmericanRoulette.scanned.list` 作为原始扫描证据，方便以后对照。

## 验证

脚本修改和规则整理后运行：

```bash
npm test
```

测试通过，共 14 个用例，覆盖：

- 默认保留 tracker 域名，只有显式传入 `--filter-ads` 时才过滤。
- 请求失败时保留输入域名，并通过 `FETCH_ERRORS` 报告失败数量。
- 记录重定向链中的中间域名。
- 没有 `content-type`、但路径不像二进制的小文本资源仍会尝试解析。
- `--mode suffix` 会移除已被 suffix 覆盖的重复 exact domain 规则。
- `--help` 正常以成功状态退出。

## 残余风险

当前扫描器是静态扫描器，不执行浏览器 JavaScript，也不观察真实浏览器网络请求。对于播放按钮点击后才发生的请求，或者 SPA 运行时动态加载的请求，后续应增加 Playwright/CDP 版本来做真实网络捕获。
