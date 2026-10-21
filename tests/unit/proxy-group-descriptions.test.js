import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { addClashProxyGroupDescriptions } from '../../functions/modules/subscription/proxy-group-descriptions.js';

describe('代理组名称中的简短说明', () => {
    it('改名后规则、组成员、DNS 和链式代理仍引用有效出口，实际节点保持原样', () => {
        const node = {
            name: '美国落地节点',
            type: 'trojan',
            server: 'example.com',
            port: 443,
            password: 'test-only',
            'dialer-proxy': '入口节点',
        };
        const input = yaml.dump({
            proxies: [node],
            'proxy-groups': [
                { name: '🚀 节点选择', type: 'select', proxies: ['♻️ 自动选择', '🇺🇸 美国节点'] },
                { name: '♻️ 自动选择', type: 'url-test', proxies: [node.name], interval: 300 },
                { name: '🇺🇸 美国节点', type: 'select', proxies: [node.name] },
                { name: '入口节点', type: 'select', proxies: ['DIRECT'] },
            ],
            dns: { nameserver: ['https://dns.example.com/dns-query#🚀 节点选择&h3=true'] },
            'rule-providers': { example: { proxy: '🚀 节点选择' } },
            rules: ['DOMAIN-SUFFIX,example.net,🇺🇸 美国节点', 'MATCH,🚀 节点选择'],
        });
        const parsed = yaml.load(addClashProxyGroupDescriptions(input));
        const targets = new Set([
            'DIRECT',
            ...parsed.proxies.map((proxy) => proxy.name),
            ...parsed['proxy-groups'].map((group) => group.name),
        ]);
        for (const group of parsed['proxy-groups']) {
            for (const target of group.proxies) expect(targets.has(target)).toBe(true);
        }
        for (const rule of parsed.rules) expect(targets.has(rule.split(',').at(-1))).toBe(true);
        expect(targets.has(parsed.proxies[0]['dialer-proxy'])).toBe(true);
        expect(parsed.proxies[0]).toEqual({
            ...node,
            'dialer-proxy': '入口节点（选择前置跳板）',
        });
        expect(parsed.dns.nameserver).toEqual([
            'https://dns.example.com/dns-query#🚀 节点选择（手动选策略）&h3=true',
        ]);
        expect(parsed['rule-providers'].example.proxy).toBe('🚀 节点选择（手动选策略）');
        expect(parsed['proxy-groups'][1].interval).toBe(300);
    });

    it('保留订阅首部、隐藏组和已有名称，并且重复处理不会追加说明', () => {
        const input =
            '#SUBSCRIBED https://example.com/sub\n' +
            yaml.dump({
                proxies: [{ name: '节点一', type: 'direct' }],
                'proxy-groups': [
                    { name: '♻️ 自动选择', type: 'url-test', proxies: ['节点一'] },
                    { name: '♻️ 自动选择（低延迟优先）', type: 'select', proxies: ['节点一'] },
                    { name: '👋 手动切换', type: 'select', proxies: ['节点一'] },
                    { name: '🌐 DNS 出口', type: 'url-test', proxies: ['节点一'], hidden: true },
                ],
                rules: ['MATCH,👋 手动切换'],
            });
        const output = addClashProxyGroupDescriptions(input);
        const names = yaml.load(output)['proxy-groups'].map((group) => group.name);
        expect(output.startsWith('#SUBSCRIBED https://example.com/sub\n')).toBe(true);
        expect(new Set(names).size).toBe(names.length);
        expect(names).toContain('♻️ 自动选择');
        expect(names).toContain('🌐 DNS 出口');
        expect(addClashProxyGroupDescriptions(output)).toBe(output);
    });

    it('说明服务实际范围，并标出没有规则引用的预留组', () => {
        const input = yaml.dump({
            proxies: [],
            'proxy-groups': [
                { name: '🤖 OpenAI 补充服务', type: 'select', proxies: ['REJECT'] },
                { name: '🤖 AI 聚合与开发平台', type: 'select', proxies: ['REJECT'] },
                { name: '🎥 流媒体', type: 'select', proxies: ['DIRECT'] },
                { name: '📲 Telegram', type: 'select', proxies: ['DIRECT'] },
            ],
            rules: ['RULE-SET,AI,🤖 OpenAI 补充服务', 'RULE-SET,STREAM,🎥 流媒体'],
        });
        const parsed = yaml.load(addClashProxyGroupDescriptions(input));
        expect(parsed['proxy-groups'].map((group) => group.name)).toEqual([
            '🤖 OpenAI 补充（登录验证等）',
            '🤖 AI 聚合与开发（Poe 等）',
            '🎥 Netflix（独立选出口）',
            '📲 Telegram（未绑定规则）',
        ]);
        expect(parsed.rules).toContain('RULE-SET,AI,🤖 OpenAI 补充（登录验证等）');
    });

    it('本地自定义模板只解释已知策略，服务范围和不同类型的同名组保持原义', () => {
        const input = yaml.dump({
            proxies: [],
            'proxy-groups': [
                { name: '🚀 节点选择', type: 'select', proxies: ['DIRECT'] },
                { name: '♻️ 自动选择', type: 'fallback', proxies: ['DIRECT'] },
                { name: '🎥 流媒体', type: 'select', proxies: ['DIRECT'] },
            ],
            rules: ['MATCH,🚀 节点选择'],
        });
        const parsed = yaml.load(addClashProxyGroupDescriptions(input, { builtinRules: false }));
        expect(parsed['proxy-groups'].map((group) => group.name)).toEqual([
            '🚀 节点选择（手动选策略）',
            '♻️ 自动选择',
            '🎥 流媒体',
        ]);
    });
});
