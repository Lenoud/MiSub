import yaml from 'js-yaml';
import { urlsToClashProxies } from '../../utils/url-to-clash.js';
import { applyMihomoDialerProxy } from './mihomo-dialer-proxy.js';
import {
    getProfileDialerProxyError,
    profileDialerProxyErrors,
} from '../../../shared/profile-dialer-proxy.js';

export function resolveProfileDialerProxies(profile, nodes) {
    const error = getProfileDialerProxyError(profile, nodes);
    if (error) throw new Error(profileDialerProxyErrors[error]);
    const byId = new Map((nodes || []).map((node) => [node.id, node]));
    const parse = (id) => {
        const proxies = urlsToClashProxies([byId.get(id)?.url || '']);
        if (proxies.length !== 1) throw new Error('前置配置引用的手动节点无法解析');
        return proxies[0];
    };
    return (profile?.dialerProxies || []).map(({ nodeId, viaNodeId }) => ({
        node: parse(nodeId),
        via: parse(viaNodeId),
    }));
}

export function assertProfileDialerProxyTarget(bindings, targetFormat, isMeta, isExternal = false) {
    if (bindings?.length && (targetFormat !== 'clash' || !isMeta || isExternal)) {
        throw new Error(
            '此订阅组已设置节点前置代理，请使用内置引擎的 Clash Meta / Mihomo 格式导入'
        );
    }
}

// 只用于内存中识别原始节点；名称、旗帜和前缀变化不影响匹配，认证信息不会额外写入输出。
function identity(proxy) {
    return JSON.stringify([
        proxy.type,
        String(proxy.server || '').toLowerCase(),
        Number(proxy.port),
        proxy.uuid || '',
        proxy.username || '',
        proxy.password || '',
    ]);
}

const escapeRegex = (name) => `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;

export function applyProfileDialerProxies(content, bindings, options = {}) {
    if (!bindings?.length) return content;
    assertProfileDialerProxyTarget(bindings, 'clash', options.isMeta);
    const config = yaml.load(content);
    if (!Array.isArray(config?.proxies)) throw new Error('前置代理需要完整的 Clash 配置');
    const resolve = (source) => {
        const candidates = config.proxies.filter((proxy) => identity(proxy) === identity(source));
        if (candidates.length !== 1) {
            throw new Error(
                '前置配置引用的节点被过滤、修改或重复，无法唯一匹配；请检查节点处理规则'
            );
        }
        return candidates[0];
    };
    const dialerProxy = bindings.map(({ node, via }) => {
        const landing = resolve(node);
        const entry = resolve(via);
        if (landing['dialer-proxy'] && landing['dialer-proxy'] !== entry.name) {
            throw new Error('规则模板与订阅组的前置代理设置冲突，请保留一处配置');
        }
        return { filter: escapeRegex(landing.name), entryFilter: escapeRegex(entry.name) };
    });
    const model = { proxies: config.proxies, meta: { isMeta: true }, extras: { dialerProxy } };
    applyMihomoDialerProxy(model);
    config.proxies = model.proxies;
    return yaml.dump(config, { lineWidth: -1, noRefs: true });
}
