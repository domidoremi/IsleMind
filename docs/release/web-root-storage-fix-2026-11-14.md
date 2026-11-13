# Web 首页会话读取修正

直接打开 Web 首页时，Expo 的首页文档处理器先于 Metro 中间件返回 HTML，缺少 SQLite Web Worker 所需的跨源隔离响应头。同一数据库通过会话详情链接可以正常读取，首页却无法加载已有消息。

Metro 启动时为 Expo 的 Web 文档处理器安装相同的 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: credentialless`。原文档处理器继续负责响应内容，重复安装只生效一次，原生 manifest 处理器保持原身份。

验证结果：

- `node --test scripts/metro-web-isolation-tests.js` 通过。测试经真实 HTTP 请求执行当前固定 Expo CLI 的首页文档处理器，检查首页与深层链接的响应头、HTML、重复安装和原生处理器身份。
- TypeScript、架构依赖与架构边界检查通过。
- 实际开发服务器的首页响应包含两项隔离响应头。浏览器在实际 320×844 CSS 视口确认 `crossOriginIsolated === true`，并从原有数据库加载已有会话消息。

该修正适用于当前固定的 Expo CLI 版本。升级 Expo 时需继续运行上述回归，确认内部 Web 文档处理器入口有效。应用其他页面、主题及原生深层操作继续按各自验收记录推进。
