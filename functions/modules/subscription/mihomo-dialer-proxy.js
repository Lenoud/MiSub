/**
 * 在指定节点上设置前置代理，保留原节点名称和数量。
 * 两个正则均匹配最终节点名，前置必须唯一，配置错误时停止生成以免退化为直连。
 */
export function applyMihomoDialerProxy(model) {
    const configs = model?.extras?.dialerProxy;
    if (!Array.isArray(configs) || configs.length === 0) return model;
    if (!model.meta?.isMeta) {
        throw new Error('指定节点前置代理需要 Mihomo / Meta 内核，请使用 meta=1 订阅');
    }

    const proxies = (model.proxies || []).map((proxy) => ({ ...proxy }));
    const assigned = new Map();
    for (const config of configs) {
        const landingRegex = new RegExp(config.filter, 'i');
        const entryRegex = new RegExp(config.entryFilter, 'i');
        const landings = proxies.filter((proxy) => landingRegex.test(proxy.name || ''));
        const entries = proxies.filter((proxy) => entryRegex.test(proxy.name || ''));
        if (landings.length === 0 || entries.length !== 1) {
            throw new Error('指定前置代理未匹配落地节点，或前置节点匹配数量不为 1');
        }
        const entry = entries[0];
        for (const landing of landings) {
            if (landing.name === entry.name) {
                throw new Error('节点不能将自身作为前置代理');
            }
            if (assigned.has(landing.name) && assigned.get(landing.name) !== entry.name) {
                throw new Error('同一节点存在冲突的前置代理配置');
            }
            assigned.set(landing.name, entry.name);
            landing['dialer-proxy'] = entry.name;
        }
    }

    const byName = new Map(proxies.map((proxy) => [proxy.name, proxy]));
    const visited = new Set();
    const visiting = new Set();
    function visit(name) {
        if (visiting.has(name)) throw new Error('前置代理存在循环引用');
        if (visited.has(name)) return;
        visiting.add(name);
        const next = byName.get(name)?.['dialer-proxy'];
        if (byName.has(next)) visit(next);
        visiting.delete(name);
        visited.add(name);
    }
    proxies.forEach((proxy) => visit(proxy.name));
    model.proxies = proxies;
    return model;
}
