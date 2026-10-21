<script setup>
    import { computed } from 'vue';
    import { useI18n } from '@/i18n/index.js';
    import { getProfileDialerProxyError } from '../../../../shared/profile-dialer-proxy.js';

    const props = defineProps({
        localProfile: { type: Object, required: true },
        nodes: { type: Array, default: () => [] },
    });
    const { t } = useI18n();
    const bindings = computed(() =>
        Array.isArray(props.localProfile.dialerProxies) ? props.localProfile.dialerProxies : []
    );
    const selectedNodes = computed(() => {
        const ids = new Set(props.localProfile.manualNodes || []);
        // 保留已取消选择节点的配置行，让用户明确清除，避免无意间丢失前置关系。
        bindings.value.forEach((item) => ids.add(item.nodeId));
        return [...ids].map((id) => props.nodes.find((node) => node.id === id) || { id, name: id });
    });
    const availableNodes = computed(() =>
        props.nodes.filter(
            (node) => node.enabled && props.localProfile.manualNodes?.includes(node.id)
        )
    );
    const error = computed(() => getProfileDialerProxyError(props.localProfile, props.nodes));
    const viaFor = (nodeId) =>
        bindings.value.find((item) => item.nodeId === nodeId)?.viaNodeId || '';
    const updateVia = (nodeId, viaNodeId) => {
        props.localProfile.dialerProxies = bindings.value.filter((item) => item.nodeId !== nodeId);
        if (viaNodeId) {
            props.localProfile.dialerProxies.push({ nodeId, viaNodeId });
            props.localProfile.subconverter = {
                ...props.localProfile.subconverter,
                engineMode: 'builtin',
            };
        }
    };
    const routeFor = (nodeId) => {
        const route = [];
        const visited = new Set();
        let current = nodeId;
        while (current && !visited.has(current)) {
            visited.add(current);
            route.unshift(props.nodes.find((node) => node.id === current)?.name || current);
            current = viaFor(current);
        }
        return [t('profileDialerProxy.client'), ...route, t('profileDialerProxy.destination')].join(
            ' → '
        );
    };
</script>

<template>
    <section class="space-y-3 border-t border-gray-200 dark:border-gray-700 pt-5">
        <h4 class="font-semibold text-gray-900 dark:text-white">
            {{ t('profileDialerProxy.title') }}
        </h4>
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('profileDialerProxy.hint') }}</p>
        <p v-if="!selectedNodes.length" class="text-sm text-gray-500">
            {{ t('profileDialerProxy.empty') }}
        </p>
        <div
            v-for="node in selectedNodes"
            :key="node.id"
            class="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2"
        >
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                <span class="text-sm font-medium text-gray-800 dark:text-gray-200">{{
                    node.name || node.id
                }}</span>
                <div>
                    <label :for="`dialer-${node.id}`" class="block text-xs text-gray-500 mb-1">{{
                        t('profileDialerProxy.via')
                    }}</label>
                    <select
                        :id="`dialer-${node.id}`"
                        :value="viaFor(node.id)"
                        class="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm dark:text-white"
                        @change="updateVia(node.id, $event.target.value)"
                    >
                        <option value="">{{ t('profileDialerProxy.direct') }}</option>
                        <option
                            v-if="
                                viaFor(node.id) &&
                                !availableNodes.some((item) => item.id === viaFor(node.id))
                            "
                            :value="viaFor(node.id)"
                            disabled
                        >
                            {{ t('profileDialerProxy.unavailable') }}
                        </option>
                        <option
                            v-for="entry in availableNodes.filter((item) => item.id !== node.id)"
                            :key="entry.id"
                            :value="entry.id"
                        >
                            {{ entry.name || entry.id }}
                        </option>
                    </select>
                </div>
            </div>
            <p class="text-xs text-indigo-600 dark:text-indigo-300 break-words">
                {{ routeFor(node.id) }}
            </p>
        </div>
        <p v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-400">
            {{ t(`profileDialerProxy.${error}`) }}
        </p>
    </section>
</template>
