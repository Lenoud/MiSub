import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import yaml from 'js-yaml';
import { ProcessorService } from '../../functions/services/processor-service.js';
import {
    applyProfileDialerProxies,
    assertProfileDialerProxyTarget,
    resolveProfileDialerProxies,
} from '../../functions/modules/subscription/profile-dialer-proxy.js';
import { getProfileDialerProxyError } from '../../shared/profile-dialer-proxy.js';
import ProfileDialerProxy from '../../src/components/modals/ProfileModal/ProfileDialerProxy.vue';
import { createI18n } from '../../src/i18n/index.js';

const nodes = ['edge', 'entry', 'other'].map((name) => ({
    id: name,
    name,
    enabled: true,
    url: `vless://00000000-0000-4000-8000-000000000001@${name}.example.com:443?security=tls#${name}`,
}));
const profile = () => ({
    manualNodes: nodes.map((node) => node.id),
    dialerProxies: [{ nodeId: 'edge', viaNodeId: 'entry' }],
    subconverter: { engineMode: 'builtin' },
});

async function render(options = {}) {
    return ProcessorService.renderOutput({
        targetFormat: 'clash',
        combinedNodeList: nodes.map((node) => node.url).join('\n'),
        subName: '测试订阅',
        config: {},
        builtinOptions: {
            isMeta: true,
            ruleLevel: 'base',
            profileDialerProxies: resolveProfileDialerProxies(profile(), nodes),
        },
        ...options,
    });
}

describe('订阅组前置代理', () => {
    it.each(['builtin', 'template'])('在 %s 规则下配置前置，保留三条原始节点', async (mode) => {
        const options =
            mode === 'template'
                ? {
                      templateSource: { kind: 'custom', value: 'test-template' },
                      storageAdapter: {
                          get: async () => [
                              {
                                  id: 'test-template',
                                  enabled: true,
                                  content:
                                      '[custom]\ncustom_proxy_group=节点选择`select`.*\n[Rule]\nMATCH,节点选择',
                              },
                          ],
                      },
                  }
                : {};
        const result = yaml.load((await render(options)).content);
        expect(result.proxies).toHaveLength(3);
        const edge = result.proxies.find((proxy) => proxy.server === 'edge.example.com');
        const entry = result.proxies.find((proxy) => proxy.server === 'entry.example.com');
        expect(edge['dialer-proxy']).toBe(entry.name);
        expect(result.proxies.filter((proxy) => proxy['dialer-proxy'])).toHaveLength(1);
    });

    it('名称和前缀变化后，前置引用仍指向最终名称', async () => {
        const original = yaml.load((await render()).content);
        original.proxies.forEach((proxy) => {
            delete proxy['dialer-proxy'];
        });
        original.proxies[0].name = '🇺🇸 新落地 (01)';
        original.proxies[1].name = '手动节点 [入口] + 01';
        const result = yaml.load(
            applyProfileDialerProxies(
                yaml.dump(original),
                resolveProfileDialerProxies(profile(), nodes),
                { isMeta: true }
            )
        );
        expect(result.proxies[0]['dialer-proxy']).toBe('手动节点 [入口] + 01');
    });

    it.each([
        ['自引用', [{ nodeId: 'edge', viaNodeId: 'edge' }], 'self'],
        [
            '循环',
            [
                { nodeId: 'edge', viaNodeId: 'entry' },
                { nodeId: 'entry', viaNodeId: 'edge' },
            ],
            'cycle',
        ],
        [
            '重复配置',
            [
                { nodeId: 'edge', viaNodeId: 'entry' },
                { nodeId: 'edge', viaNodeId: 'other' },
            ],
            'duplicate',
        ],
        ['未选入的前置', [{ nodeId: 'edge', viaNodeId: 'missing' }], 'missing'],
    ])('拒绝%s', (_, dialerProxies, error) => {
        expect(getProfileDialerProxyError({ ...profile(), dialerProxies }, nodes)).toBe(error);
        expect(() => resolveProfileDialerProxies({ ...profile(), dialerProxies }, nodes)).toThrow();
    });

    it('节点被过滤或存在重复端点时停止输出', async () => {
        const config = yaml.load((await render()).content);
        const bindings = resolveProfileDialerProxies(profile(), nodes);
        config.proxies.pop();
        config.proxies.pop();
        expect(() =>
            applyProfileDialerProxies(yaml.dump(config), bindings, { isMeta: true })
        ).toThrow('唯一匹配');
        config.proxies.push({ ...config.proxies[0], name: '重复落地' });
        expect(() =>
            applyProfileDialerProxies(yaml.dump(config), bindings, { isMeta: true })
        ).toThrow('唯一匹配');
    });

    it('拒绝模板与订阅组的冲突前置', async () => {
        const config = yaml.load((await render()).content);
        config.proxies[0]['dialer-proxy'] = 'other';
        expect(() =>
            applyProfileDialerProxies(
                yaml.dump(config),
                resolveProfileDialerProxies(profile(), nodes),
                { isMeta: true }
            )
        ).toThrow('冲突');
    });

    it('拒绝不支持前置的格式和外部引擎，避免退回未含前置的输出', async () => {
        expect(
            getProfileDialerProxyError(
                { ...profile(), subconverter: { engineMode: 'external' } },
                nodes
            )
        ).toBe('engine');
        const bindings = resolveProfileDialerProxies(profile(), nodes);
        expect(() => assertProfileDialerProxyTarget(bindings, 'base64', true)).toThrow(
            'Clash Meta'
        );
        expect(() => assertProfileDialerProxyTarget(bindings, 'clash', true, true)).toThrow(
            'Clash Meta'
        );
        await expect(render({ targetFormat: 'singbox' })).rejects.toThrow('Clash Meta');
        await expect(
            render({ builtinOptions: { profileDialerProxies: bindings, isMeta: false } })
        ).rejects.toThrow('Clash Meta');
    });
});

describe('前置节点选择界面', () => {
    it('显示现有前置关系，通过下拉框变更或移除后影响真实订阅输出', async () => {
        const localProfile = reactive(profile());
        const wrapper = mount(ProfileDialerProxy, {
            props: { localProfile, nodes },
            global: { plugins: [createI18n({ initialLocale: 'zh-CN' })] },
        });
        expect(wrapper.text()).toContain('客户端 → entry → edge → 目标网站');
        const select = wrapper.get('#dialer-edge');
        expect(select.element.value).toBe('entry');
        expect(select.findAll('option').map((option) => option.attributes('value'))).not.toContain(
            'edge'
        );
        await select.setValue('other');
        expect(localProfile.dialerProxies).toEqual([{ nodeId: 'edge', viaNodeId: 'other' }]);
        const output = yaml.load(
            (
                await render({
                    builtinOptions: {
                        isMeta: true,
                        profileDialerProxies: resolveProfileDialerProxies(localProfile, nodes),
                    },
                })
            ).content
        );
        expect(output.proxies[0]['dialer-proxy']).toBe(output.proxies[2].name);
        await select.setValue('');
        const directOutput = yaml.load(
            (
                await render({
                    builtinOptions: {
                        isMeta: true,
                        profileDialerProxies: resolveProfileDialerProxies(localProfile, nodes),
                    },
                })
            ).content
        );
        expect(directOutput.proxies.every((proxy) => !proxy['dialer-proxy'])).toBe(true);
        wrapper.unmount();
    });

    it('取消选择前置节点后保留设置并明确提示', async () => {
        const localProfile = reactive(profile());
        const wrapper = mount(ProfileDialerProxy, {
            props: { localProfile, nodes },
            global: { plugins: [createI18n({ initialLocale: 'zh-CN' })] },
        });
        localProfile.manualNodes = ['edge', 'other'];
        await wrapper.vm.$nextTick();
        expect(wrapper.get('[role="alert"]').text()).toContain('选入本订阅组');
        expect(wrapper.get('#dialer-edge').element.value).toBe('entry');
        expect(localProfile.dialerProxies).toHaveLength(1);
        wrapper.unmount();
    });
});
