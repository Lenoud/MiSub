# Vertflux 部署

正式地址为 https://sub.vertflux.com ，Cloudflare Pages 项目为 `vertflux-sub`。
本仓库从 https://github.com/imzyb/MiSub fork，使用 GitHub Actions 构建并发布。

## 发布与更新

- 向 `main` 提交或合并代码后，依次执行测试、前端构建、Pages Functions 打包、幂等建表及正式发布。
- PR 和非生产分支只执行构建检查，不读取生产部署凭据，不发布。
- 每天北京时间 11:07 检查上游；GitHub 定时任务可能延迟。发现更新时创建或更新 `updates/upstream` PR，并显式运行构建检查。
- 上游更新需要人工审核合并；不自动合并，不强制覆盖生产主分支。
- 上游自带的直接同步工作流已移除，`.github`、`wrangler.jsonc` 和本文档由保留清单保护。
- 上游合并出现冲突时停止，并由 Actions 报告，不发布存在冲突的代码。

## 运行配置

Cloudflare KV 绑定为 `MISUB_KV`，D1 绑定为 `MISUB_DB`。D1 保存业务数据，KV 满足上游的认证等兼容需求。
初始化关闭公开订阅展示，使用独立的订阅 Token；客户端拉取订阅继续使用 MiSub 自身的订阅鉴权。
管理后台及管理 API 使用现有 Casdoor/OAuth2-Proxy 统一认证，允许账号为 `vertflux/liubiao`。
入口为 `https://sub.vertflux.com/dashboard`，已登录 SSO 后直接进入后台。
订阅下载、自带 API Key 的外部 API、Cron 和签名回调继续使用 MiSub 原生机器鉴权。
Pages Functions 中间件验证 SSO 后，仅在当前服务器请求内生成内部 MiSub 会话，不向浏览器下发内部 Cookie。
原生密码或 Cookie 不能独立访问管理接口；默认 Pages 域名跳转正式入口。
已知的 SSO 接入前部署会在正式入口验收通过后关闭，当前生产版本会保留。
退出按钮通过 `/oauth2/sign_out?rd=/signed-out` 清除当前应用的 SSO Cookie。

GitHub Actions 加密 Secret：

| 名称 | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 当前账号的 Pages、D1 和 KV 部署权限 |
| `MISUB_ADMIN_PASSWORD` | 管理后台密码 |
| `MISUB_COOKIE_SECRET` | 稳定的会话签名密钥 |
| `MISUB_CRON_SECRET` | 自动任务鉴权密钥 |

应用凭据在正式发布前同步为 Cloudflare Pages 加密 Secret。保留原生管理员密码作为应用内部配置，浏览器统一使用 SSO。
账号访问权限通过 VPS 上的 `/usr/local/sbin/vertflux-auth-site` 和站点清单管理。
前端使用 `VITE_VERTFLUX_SSO=true` 构建；中间件对正式部署始终强制认证。
实际凭据、订阅地址及节点私钥不提交到此公开仓库；运行数据独立保存在 Cloudflare 存储中。
`schema.sql` 只包含可重复执行的建表和建索引语句，发布不会重新初始化或清空业务数据。

## 本地检查

```sh
npm ci --no-audit --no-fund
npm run test:run
VITE_VERTFLUX_SSO=true npm run build
npx --no-install wrangler pages functions build functions --outdir .wrangler/functions-check --compatibility-date 2026-10-21 --compatibility-flags nodejs_compat
```
