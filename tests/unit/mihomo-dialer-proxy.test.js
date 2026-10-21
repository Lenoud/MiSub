import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { renderClashFromIniTemplate } from '../../functions/modules/subscription/template-pipeline.js';
import { parseIniTemplate } from '../../functions/modules/subscription/template-parsers/ini-template-parser.js';
import { applyMihomoDialerProxy } from '../../functions/modules/subscription/mihomo-dialer-proxy.js';

const proxies = ['🇺🇸 sky-edge-node01', '🇭🇰 sky-cheyonserver', '🇨🇳 sky-ttnet-node01'].map(
    (name, index) => ({
        name,
        type: 'vless',
        server: `node${index}.example.com`,
        port: 443,
        uuid: 'test',
        tls: true,
        flow: 'xtls-rprx-vision',
        'reality-opts': { 'public-key': 'test' },
    })
);

function render(directives = ['sky-edge-node01$`sky-cheyonserver$'], options = {}) {
    return yaml.load(
        renderClashFromIniTemplate(
            [
                '[custom]',
                'custom_proxy_group=节点选择`select`.*',
                ...directives.map((value) => `custom_dialer_proxy=${value}`),
                '[Rule]',
                'MATCH,节点选择',
            ].join('\n'),
            { proxies: proxies.map((proxy) => ({ ...proxy })), isMeta: true, ...options }
        )
    );
}

describe('指定节点前置代理', () => {
    it('仅将选定的落地节点通过前置连接，保留三条原始节点及协议参数', () => {
        const result = render();
        expect(result.proxies).toHaveLength(3);
        expect(result.proxies[0]).toEqual({
            ...proxies[0],
            'dialer-proxy': proxies[1].name,
        });
        expect(result.proxies.slice(1)).toEqual(proxies.slice(1));
        expect(result['proxy-groups'].find((group) => group.name === '节点选择').proxies).toEqual(
            proxies.map((proxy) => proxy.name)
        );
        expect(result['proxy-groups'].every((group) => group.type !== 'relay')).toBe(true);
    });

    it('模板未配置前置时保持原输出', () => {
        expect(render([]).proxies).toEqual(proxies);
    });

    it('拒绝在不支持的内核上生成可绕过前置的配置', () => {
        expect(() => render(undefined, { isMeta: false })).toThrow('Mihomo / Meta');
    });

    it.each([
        ['missing$`sky-cheyonserver$'],
        ['sky-edge-node01$`missing$'],
        ['sky-edge-node01$`sky-.*'],
        ['sky-edge-node01$`sky-edge-node01$'],
        ['[`sky-cheyonserver$'],
        ['sky-edge-node01$'],
        ['sky-edge-node01$`'],
    ])('拒绝无法确定链路的配置 %s', (directive) => {
        expect(() => render([directive])).toThrow();
    });

    it('拒绝相互前置和多跳循环', () => {
        expect(() =>
            render(['sky-edge-node01$`sky-cheyonserver$', 'sky-cheyonserver$`sky-edge-node01$'])
        ).toThrow('循环');
        expect(() =>
            render([
                'sky-edge-node01$`sky-cheyonserver$',
                'sky-cheyonserver$`sky-ttnet-node01$',
                'sky-ttnet-node01$`sky-edge-node01$',
            ])
        ).toThrow('循环');
    });

    it('拒绝同一节点的前置冲突', () => {
        expect(() =>
            render(['sky-edge-node01$`sky-cheyonserver$', 'sky-edge-node01$`sky-ttnet-node01$'])
        ).toThrow('冲突');
    });

    it('重复渲染不会污染原始模型', () => {
        const model = parseIniTemplate(
            '[custom]\ncustom_dialer_proxy=sky-edge-node01$`sky-cheyonserver$',
            { proxies, isMeta: true }
        );
        const first = applyMihomoDialerProxy({ ...model });
        const second = applyMihomoDialerProxy({ ...model });
        expect(first.proxies).toEqual(second.proxies);
        expect(model.proxies).toEqual(proxies);
        expect(proxies.every((proxy) => !proxy['dialer-proxy'])).toBe(true);
    });
});
