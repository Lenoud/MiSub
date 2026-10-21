import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { generateBuiltinClashConfig } from '../../functions/modules/subscription/builtin-clash-generator.js';
import { addClashProxyGroupDescriptions } from '../../functions/modules/subscription/proxy-group-descriptions.js';
import { parseIniTemplate } from '../../functions/modules/subscription/template-parsers/ini-template-parser.js';
import { renderClashFromIniTemplate } from '../../functions/modules/subscription/template-pipeline.js';

const template = readFileSync('docs/examples/vertflux-standard-described.ini', 'utf8');

function normalizeProviderCacheNames(config) {
    const result = structuredClone(config);
    const providers = result['rule-providers'] || {};
    result.rules = result.rules.map((rule) => {
        const parts = rule.split(',');
        if (parts[0] === 'RULE-SET') parts[1] = providers[parts[1]].url;
        return parts.join(',');
    });
    result['rule-providers'] = Object.values(providers)
        .map(({ path, ...provider }) => provider)
        .sort((a, b) => a.url.localeCompare(b.url));
    // INI 的正则已展开为相同节点列表；filter 是保留给客户端的冗余筛选条件。
    result['proxy-groups'] = result['proxy-groups'].map(({ filter, ...group }) => group);
    return result;
}

describe('标准分流的可编辑模板', () => {
    it('在相同节点下保留默认 Standard 的策略、规则顺序、DNS 与测速参数', () => {
        const nodeList = ['美国静态节点', '美国高速节点', '香港高速节点', '香港备用节点']
            .map(
                (name, i) =>
                    `trojan://test-only@node${i}.example.com:443#${encodeURIComponent(name)}`
            )
            .join('\n');
        const options = {
            ruleLevel: 'std',
            isMeta: true,
            managedConfigUrl: 'https://example.com/sub',
            enableUdp: true,
        };
        const builtin = yaml.load(
            addClashProxyGroupDescriptions(generateBuiltinClashConfig(nodeList, options))
        );
        const custom = yaml.load(
            renderClashFromIniTemplate(template, { ...options, nodeList, ruleLevel: 'none' })
        );

        expect(normalizeProviderCacheNames(custom)).toEqual(normalizeProviderCacheNames(builtin));
        expect(custom['proxy-groups'].filter((group) => group.hidden)).toHaveLength(3);
        expect(custom.rules.at(-1)).toBe('MATCH,🚀 节点选择（手动选策略）');
    });

    it('两种 INI 语法都保留 false、零容差和数值参数的实际类型', () => {
        const model = parseIniTemplate(`
[Proxy Group]
公开测速 = url-test, 节点, hidden=false, lazy=false, interval=300, tolerance=0
[custom]
custom_proxy_group=隐藏测速\`url-test\`.*\`hidden=true\`interval=300\`tolerance=50
`);
        expect(model.groups[0].options).toEqual({
            hidden: false,
            lazy: false,
            interval: 300,
            tolerance: 0,
        });
        expect(model.groups[1].options).toEqual({ hidden: true, interval: 300, tolerance: 50 });
    });
});
