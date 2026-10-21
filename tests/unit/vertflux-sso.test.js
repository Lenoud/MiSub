// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createVertfluxSso } from '../../functions/_lib/vertflux-sso.js';
import { authMiddleware } from '../../functions/modules/auth-middleware.js';

const origin = 'https://sub.vertflux.com';
const identity = { subject: 'test-subject', username: 'test-user' };
const settings = { mytoken: 'private-sub-token', profileToken: 'private-profile-token' };

function fixture(fetchAuth = vi.fn(async () => Response.json(identity))) {
    const env = { COOKIE_SECRET: 'test-server-session-secret' };
    const next = vi.fn(async () => new Response('application'));
    const guard = createVertfluxSso({ fetchAuth, readSettings: async () => settings });
    const call = (path, init = {}) =>
        guard({ request: new Request(origin + path, init), env, next });
    return { guard, call, env, next, fetchAuth };
}

describe('Vertflux SSO 管理与订阅边界', () => {
    it('匿名页面跳转 SSO，匿名管理 API 和原生登录拒绝访问', async () => {
        const { call, next } = fixture();
        for (const path of ['/', '/login', '/dashboard', '/dashboard/settings']) {
            const response = await call(path);
            expect(response.status).toBe(302);
            expect(response.headers.get('Location')).toContain(origin + '/oauth2/start?rd=');
        }
        for (const path of ['/api/data', '/api/settings', '/%61pi/settings', '//api/settings']) {
            expect((await call(path)).status).toBe(401);
        }
        expect(
            (await call('/api/login', { method: 'POST', headers: { Origin: origin }, body: '{}' }))
                .status
        ).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('原生 Cookie、Bearer 和伪造身份头不能替代 SSO', async () => {
        const { call, next } = fixture();
        const response = await call('/api/settings', {
            headers: {
                Cookie: 'auth_session=forged',
                Authorization: 'Bearer forged',
                'X-Vertflux-Subject': 'forged',
            },
        });
        expect(response.status).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('只有有效 SSO 可以转换为服务器内部会话，内部 Cookie 不下发浏览器', async () => {
        const { call, next, env, fetchAuth } = fixture();
        next.mockImplementation(async (request) => {
            expect(await authMiddleware(request, env)).toBe(true);
            expect(request.headers.get('Cookie')).not.toContain('__Host-vertflux_sso');
            expect(request.headers.get('X-Vertflux-Subject')).toBeNull();
            return new Response('application', {
                headers: { 'Set-Cookie': 'auth_session=should-not-leak' },
            });
        });
        const response = await call('/api/settings', {
            headers: {
                Cookie: '__Host-vertflux_sso=valid; auth_session=forged; preference=zh',
                'X-Vertflux-Subject': 'forged',
            },
        });
        expect(fetchAuth.mock.calls[0][0]).toBe(
            'https://auth.vertflux.com/api/session?app=sub.vertflux.com'
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('Set-Cookie')).toBeNull();
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(
            (
                await call('/login', { headers: { Cookie: '__Host-vertflux_sso=valid' } })
            ).headers.get('Location')
        ).toBe(origin + '/dashboard');
    });

    it.each([401, 403, 500])('认证网关返回 %i 时不放行业务请求', async (status) => {
        const { call, next } = fixture(vi.fn(async () => new Response('', { status })));
        expect(
            (await call('/api/settings', { headers: { Cookie: '__Host-vertflux_sso=invalid' } }))
                .status
        ).toBe(status === 500 ? 503 : status);
        expect(next).not.toHaveBeenCalled();
    });

    it('认证服务网络故障时拒绝请求', async () => {
        const { call, next } = fixture(async () => {
            throw new Error('offline');
        });
        expect(
            (await call('/api/settings', { headers: { Cookie: '__Host-vertflux_sso=invalid' } }))
                .status
        ).toBe(503);
        expect(next).not.toHaveBeenCalled();
    });

    it('订阅和机器接口交给各自的 Token 鉴权，不注入管理会话', async () => {
        const { call, next, fetchAuth } = fixture();
        for (const path of [
            '/sub/invalid-token',
            '/private-sub-token',
            '/private-profile-token/example',
            '/cron',
            '/api/ext/v1/subscriptions',
            '/api/external-nodes-callback',
            '/api/telegram/webhook',
        ]) {
            await call(path, {
                headers: {
                    Cookie: '__Host-vertflux_sso=valid; auth_session=forged',
                    Authorization: 'Bearer machine-token',
                },
            });
            const request = next.mock.calls.at(-1)[0];
            expect(request.headers.get('Cookie')).toBeNull();
            expect(request.headers.get('Authorization')).toBe('Bearer machine-token');
        }
        expect(fetchAuth).not.toHaveBeenCalled();
        expect((await call('/%73ub/invalid-token')).status).toBe(302);
        expect((await call('/private-sub-token/../api/settings')).status).toBe(401);
    });

    it('默认和历史部署域名只能跳转正式入口', async () => {
        const { guard, next, env } = fixture();
        for (const hostname of ['vertflux-sub.pages.dev', 'old.vertflux-sub.pages.dev']) {
            const response = await guard({
                request: new Request(`https://${hostname}/api/settings`),
                env,
                next,
            });
            expect(response.status).toBe(302);
            expect(response.headers.get('Location')).toBe(origin + '/api/settings');
        }
        expect(next).not.toHaveBeenCalled();
    });

    it('跨站写入及外部返回地址被拒绝', async () => {
        const { call, next } = fixture();
        expect(
            (
                await call('/api/settings', {
                    method: 'POST',
                    headers: { Origin: 'https://other.example' },
                })
            ).status
        ).toBe(403);
        expect((await call('/oauth2/start?rd=https://other.example/')).status).toBe(400);
        expect((await call('/oauth2/start?rd=//other.example/')).status).toBe(400);
        expect(next).not.toHaveBeenCalled();
    });

    it('OAuth 回调及退出只代理到固定网关，保留安全 Cookie', async () => {
        const fetchAuth = vi.fn(
            async () =>
                new Response(null, {
                    status: 302,
                    headers: {
                        Location: origin + '/signed-out',
                        'Set-Cookie': '__Host-vertflux_sso=; Path=/; Secure; HttpOnly; Max-Age=0',
                    },
                })
        );
        const { call } = fixture(fetchAuth);
        const response = await call('/oauth2/sign_out?rd=/signed-out', {
            headers: { Cookie: '__Host-vertflux_sso=valid; auth_session=forged' },
        });
        expect(fetchAuth.mock.calls[0][0]).toBe(
            'https://auth.vertflux.com/edge/sub/oauth2/sign_out?rd=/signed-out'
        );
        expect(fetchAuth.mock.calls[0][1].headers.Cookie).toBe('__Host-vertflux_sso=valid');
        expect(response.status).toBe(302);
        expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
        expect((await call('/signed-out')).status).toBe(200);
    });
});
