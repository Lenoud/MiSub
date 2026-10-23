import { auditGateway, callbackError, invalidPath, blockedProbe } from './gateway-audit.js';
import { SettingsCache } from '../storage-adapter.js';
import { createSignedToken } from '../modules/auth-middleware.js';

const HOST = 'sub.vertflux.com';
const ORIGIN = `https://${HOST}`;
const AUTH = 'https://auth.vertflux.com';
const SSO_COOKIE = '__Host-vertflux_sso';

function privateResponse(response) {
    const result = new Response(response.body, response);
    result.headers.set('Cache-Control', 'private, no-store');
    result.headers.set('Vary', 'Cookie');
    result.headers.set('Referrer-Policy', 'no-referrer');
    return result;
}

function error(status, message) {
    return privateResponse(Response.json({ error: message }, { status }));
}

function ssoCookies(request) {
    return (request.headers.get('Cookie') || '')
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part.split('=')[0].startsWith(SSO_COOKIE))
        .join('; ');
}

function applicationHeaders(request) {
    const headers = new Headers(request.headers);
    for (const name of [...headers.keys()]) {
        if (
            /^(x-vertflux-|x-auth-request-|x-forwarded-(user|subject|email|groups|preferred-username)|x-user$|x-email$|remote-user$|cf-access-)/i.test(
                name
            )
        ) {
            headers.delete(name);
        }
    }
    const cookies = (headers.get('Cookie') || '')
        .split(';')
        .map((part) => part.trim())
        .filter(
            (part) =>
                part &&
                !part.split('=')[0].startsWith(SSO_COOKIE) &&
                part.split('=')[0] !== 'auth_session'
        );
    if (cookies.length) headers.set('Cookie', cookies.join('; '));
    else headers.delete('Cookie');
    return headers;
}

function machineRoute(path, settings) {
    // 这些路由仍由 MiSub 验证订阅 Token、API Key、定时任务密钥或回调签名。
    if (path.startsWith('/sub/') || path === '/cron') return true;
    if (path === '/api/ext/v1' || path.startsWith('/api/ext/v1/')) return true;
    if (['/api/external-nodes-callback', '/api/telegram/webhook'].includes(path)) return true;
    const first = path.split('/')[1];
    return Boolean(
        first && [settings.mytoken, settings.profileToken].some((token) => token && token === first)
    );
}

export function createVertfluxSso({
    fetchAuth = (...args) => fetch(...args),
    readSettings = (env) => SettingsCache.get(env),
} = {}) {
    async function oauth(request, pathname, search, audit) {
        try {
            const started = Date.now();
            const response = await fetchAuth(`${AUTH}/edge/sub${pathname}${search}`, {
                headers: { Cookie: ssoCookies(request), Accept: 'text/html', 'X-Request-ID': audit.request_id },
                redirect: 'manual',
                signal: AbortSignal.timeout(15000),
            });
            audit.upstream_status = response.status;
            audit.upstream_duration_ms = Date.now() - started;
            if (response.status >= 500) {
                audit.reason = 'oauth_upstream_error';
                return error(503, '统一认证暂时不可用，请稍后再试。');
            }
            return response;
        } catch {
            audit.reason = 'oauth_network_error';
            return error(503, '统一认证暂时不可用，请稍后再试。');
        }
    }

    const guarded = auditGateway(HOST, async (request, env, audit, context) => {
        const { next } = context;
        const url = new URL(request.url);
        const safe = ['GET', 'HEAD'].includes(request.method);
        if (url.hostname !== HOST || url.protocol !== 'https:') {
            return safe
                ? privateResponse(Response.redirect(`${ORIGIN}${url.pathname}${url.search}`, 302))
                : error(403, '请使用应用的正式域名。');
        }
        let path;
        try {
            path = decodeURIComponent(url.pathname).replace(/\/{2,}/g, '/');
        } catch {
            return error(400, '请求路径无效。');
        }
        if (invalidPath(path)) return error(400, '请求路径无效。');
        if (blockedProbe(path)) return error(404, '入口不存在。');
        if (url.pathname.startsWith('/oauth2/')) {
            if (!['/oauth2/start', '/oauth2/callback', '/oauth2/sign_out'].includes(url.pathname))
                return error(404, '入口不存在。');
            if (!safe) return error(405, '登录入口仅接受 GET 请求。');
            try {
                if (
                    url.searchParams.has('rd') &&
                    new URL(url.searchParams.get('rd'), ORIGIN).origin !== ORIGIN
                )
                    return error(400, '登录后的返回地址必须属于当前应用。');
            } catch {
                return error(400, '登录后的返回地址无效。');
            }
            const callbackStatus = callbackError(request);
            if (callbackStatus) {
                audit.auth_result = 'denied';
                audit.reason = callbackStatus === 400 ? 'oauth_callback_parameters_missing' : 'oauth_csrf_cookie_missing';
                return error(callbackStatus, '登录回调无效，请重新登录。');
            }
            audit.auth_result = 'oauth';
            return privateResponse(await oauth(request, url.pathname, url.search, audit));
        }
        if (url.pathname === '/signed-out') {
            return privateResponse(
                new Response(
                    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Vertflux</title><body><h1>已退出 MiSub</h1><p><a href="/dashboard">重新登录</a> · <a href="https://sso.vertflux.com/">账户中心</a></p></body></html>',
                    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
                )
            );
        }
        const settings = (await readSettings(env)) || {};
        // 只有与后端逐字一致的路径可以走机器接口，编码变体一律走 SSO。
        if (url.pathname === path && machineRoute(path, settings)) {
            return next(new Request(request, { headers: applicationHeaders(request) }));
        }
        if (
            !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
            request.headers.get('Origin') !== ORIGIN
        )
            return error(403, '当前操作必须从应用页面发起。');

        audit.auth_result = 'required';
        const cookies = ssoCookies(request);
        let identity;
        if (cookies) {
            try {
                const started = Date.now();
                const response = await fetchAuth(`${AUTH}/api/session?app=${HOST}`, {
                    headers: { Cookie: cookies, Accept: 'application/json', 'X-Request-ID': audit.request_id },
                    redirect: 'manual',
                    signal: AbortSignal.timeout(15000),
                });
                audit.upstream_status = response.status;
                audit.upstream_duration_ms = Date.now() - started;
                if (response.status === 403) {
                    audit.auth_result = 'denied'; audit.reason = 'application_permission_denied';
                    return error(403, '当前账号没有访问该应用的权限。');
                }
                if (response.ok) {
                    identity = await response.json();
                    if (!identity?.subject || !identity?.username)
                        return error(503, '统一认证返回的身份信息不完整。');
                } else if (response.status !== 401) {
                    audit.reason = 'session_upstream_error';
                    return error(503, '统一认证暂时不可用，请稍后再试。');
                }
            } catch {
                audit.reason = 'session_network_error';
                return error(503, '统一认证暂时不可用，请稍后再试。');
            }
        }
        if (!identity) {
            audit.auth_result = 'denied'; audit.reason = 'login_required';
            const loginUrl = `/oauth2/start?rd=${encodeURIComponent(url.href)}`;
            if (
                path.startsWith('/api/') ||
                !safe ||
                request.headers.get('Accept')?.includes('application/json')
            ) {
                return privateResponse(
                    Response.json({ error: '请先登录。', loginUrl }, { status: 401 })
                );
            }
            return privateResponse(Response.redirect(`${ORIGIN}${loginUrl}`, 302));
        }
        audit.auth_result = 'allowed';
        if (path === '/api/logout') {
            const response = await oauth(request, '/oauth2/sign_out', '?rd=/signed-out', audit);
            if (![200, 302].includes(response.status))
                return error(503, '退出统一认证失败，请稍后再试。');
            const headers = new Headers(response.headers);
            headers.delete('Location');
            headers.set('Content-Type', 'application/json');
            headers.append(
                'Set-Cookie',
                'auth_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'
            );
            return privateResponse(new Response(JSON.stringify({ success: true }), { headers }));
        }
        if (path === '/api/login') return privateResponse(Response.json({ success: true }));
        if (
            safe &&
            [
                settings.customLoginPath
                    ? `/${settings.customLoginPath.replace(/^\/+/, '')}`
                    : '/login',
                '/login',
            ].includes(path)
        ) {
            return privateResponse(Response.redirect(`${ORIGIN}/dashboard`, 302));
        }
        if (!env.COOKIE_SECRET) return error(503, '应用的内部认证尚未配置。');
        const headers = applicationHeaders(request);
        headers.set('X-Vertflux-Request-ID', audit.request_id);
        // 已验证的 SSO 会话在本次服务器请求内转换为 MiSub 会话，不向浏览器下发内部 Cookie。
        const internal = await createSignedToken(env.COOKIE_SECRET, String(Date.now()));
        headers.set(
            'Cookie',
            [headers.get('Cookie'), `auth_session=${internal}`].filter(Boolean).join('; ')
        );
        const response = privateResponse(await next(new Request(request, { headers })));
        const cookiesOut = response.headers.getSetCookie();
        response.headers.delete('Set-Cookie');
        for (const cookie of cookiesOut) {
            if (!cookie.startsWith('auth_session=')) response.headers.append('Set-Cookie', cookie);
        }
        return response;
    });
    return (context) => guarded(context.request, context.env, context);
}
