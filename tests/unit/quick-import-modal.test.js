import { beforeEach, describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import QuickImportModal from '../../src/components/modals/QuickImportModal.vue';
import { createI18n } from '../../src/i18n/index.js';

const globalOptions = () => ({
    plugins: [createI18n({ initialLocale: 'en-US' })],
    stubs: {
        Teleport: true,
    },
});

describe('QuickImportModal', () => {
    beforeEach(() => {
        window.history.replaceState({}, '', '/public');
    });

    it('renders through shared Modal and emits close on visibility update', async () => {
        const wrapper = mount(QuickImportModal, {
            props: {
                show: true,
                profile: { id: 'p1', name: 'Demo' },
                clients: [],
                profileToken: 'profiles',
            },
            global: globalOptions(),
        });

        expect(wrapper.text()).toContain('Choose client import');
        await wrapper.findComponent({ name: 'Modal' }).vm.$emit('update:show', false);

        expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('uses mihomo deep link and an explicit Clash target for Clash-Party one-click import', async () => {
        delete window.location;
        window.location = { href: 'https://misub.example/public', origin: 'https://misub.example' };

        const wrapper = mount(QuickImportModal, {
            props: {
                show: true,
                profile: { id: 'p1', customId: '!luckyss', name: 'Lucky SS' },
                clients: [{ id: 'clash-party', name: 'Clash Party', platforms: ['windows'] }],
                profileToken: '',
            },
            global: globalOptions(),
        });

        await wrapper.find('button.group').trigger('click');

        const expectedUrl = encodeURIComponent(
            'https://misub.example/profiles/!luckyss?target=clash'
        );
        expect(window.location.href).toBe(
            `mihomo://install-config?url=${expectedUrl}&name=Lucky%20SS`
        );
    });

    it('小火箭一键导入携带完整 HTTPS 地址和固定 Base64 格式', async () => {
        delete window.location;
        window.location = { href: 'https://misub.example/public', origin: 'https://misub.example' };
        const wrapper = mount(QuickImportModal, {
            props: {
                show: true,
                profile: { id: 'p1', customId: 'daily', name: '我的节点' },
                clients: [{ id: 'shadowrocket', name: 'Shadowrocket', platforms: ['ios'] }],
                profileToken: 'share-token',
            },
            global: globalOptions(),
        });
        await wrapper.find('button.group').trigger('click');
        const match = window.location.href.match(
            /^shadowrocket:\/\/add\/sub:\/\/([^?]+)\?remark=(.*)$/
        );
        expect(match).not.toBeNull();
        expect(atob(match[1])).toBe('https://misub.example/share-token/daily?target=base64');
        expect(decodeURIComponent(match[2])).toBe('我的节点');
    });

    it('前置订阅禁用不兼容客户端，但允许 Mihomo 完整导入', async () => {
        delete window.location;
        window.location = { href: 'https://misub.example/public', origin: 'https://misub.example' };
        const wrapper = mount(QuickImportModal, {
            props: {
                show: true,
                profile: {
                    id: 'p1',
                    name: '前置订阅',
                    dialerProxies: [{ nodeId: 'edge', viaNodeId: 'entry' }],
                },
                clients: [
                    { id: 'shadowrocket', name: 'Shadowrocket' },
                    { id: 'clash-party', name: 'Clash Party' },
                ],
                profileToken: 'share-token',
            },
            global: globalOptions(),
        });
        const shadowrocket = wrapper
            .findAll('button.group')
            .find((item) => item.text().includes('Shadowrocket'));
        expect(shadowrocket.attributes('disabled')).toBeDefined();
        await shadowrocket.trigger('click');
        expect(window.location.href).toBe('https://misub.example/public');
        const mihomo = wrapper
            .findAll('button.group')
            .find((item) => item.text().includes('Clash Party'));
        await mihomo.trigger('click');
        const imported = new URL(window.location.href).searchParams.get('url');
        expect(imported).toBe(
            'https://misub.example/share-token/p1?target=clash&meta=1&engine=builtin'
        );
    });
});
