import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CopyLinkModal from '../../src/components/modals/CopyLinkModal.vue';
import { createI18n } from '../../src/i18n/index.js';

const modalStub = {
    props: ['show'],
    template: '<div v-if="show"><slot name="title" /><slot name="body" /></div>',
};

describe('CopyLinkModal', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('copies a native sing-box link instead of a base64 link', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        const wrapper = mount(CopyLinkModal, {
            props: {
                show: true,
                token: 'share-token',
                profile: { id: 'p1', customId: 'daily', name: '日常使用' },
            },
            global: {
                plugins: [createPinia(), createI18n({ initialLocale: 'zh-CN' })],
                stubs: { Modal: modalStub },
            },
        });

        const singBoxItem = wrapper
            .findAll('.cursor-pointer')
            .find((item) => item.text().includes('Sing-Box'));
        expect(singBoxItem).toBeTruthy();
        await singBoxItem.trigger('click');

        expect(writeText).toHaveBeenCalledWith(
            `${window.location.origin}/share-token/daily?singbox`
        );
        expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('?base64'));
    });

    it('为小火箭复制固定的 Base64 链接，避免依赖客户端 UA', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        const wrapper = mount(CopyLinkModal, {
            props: { show: true, token: 'share-token', profile: { id: 'p1', name: '我的节点' } },
            global: {
                plugins: [createPinia(), createI18n({ initialLocale: 'zh-CN' })],
                stubs: { Modal: modalStub },
            },
        });
        const button = wrapper
            .findAll('button')
            .find((item) => item.text().includes('Shadowrocket'));
        await button.trigger('click');
        expect(writeText).toHaveBeenCalledWith(
            `${window.location.origin}/share-token/p1?target=base64`
        );
    });

    it('前置订阅不允许复制会报错的小火箭链接，Mihomo 链接显式保留前置', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        const wrapper = mount(CopyLinkModal, {
            props: {
                show: true,
                token: 'share-token',
                profile: { id: 'p1', dialerProxies: [{ nodeId: 'edge', viaNodeId: 'entry' }] },
            },
            global: {
                plugins: [createPinia(), createI18n({ initialLocale: 'zh-CN' })],
                stubs: { Modal: modalStub },
            },
        });
        expect(wrapper.get('[role="status"]').text()).toContain('前置代理');
        const shadowrocket = wrapper
            .findAll('button')
            .find((item) => item.text().includes('Shadowrocket'));
        expect(shadowrocket.attributes('disabled')).toBeDefined();
        await shadowrocket.trigger('click');
        expect(writeText).not.toHaveBeenCalled();
        const mihomo = wrapper.findAll('button').find((item) => item.text().includes('Clash Meta'));
        await mihomo.trigger('click');
        expect(writeText).toHaveBeenCalledWith(
            `${window.location.origin}/share-token/p1?target=clash&meta=1&engine=builtin`
        );
    });
});
