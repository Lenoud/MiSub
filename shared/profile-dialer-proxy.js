// 前端保存和订阅生成共用校验，引用节点 ID，避免名称调整后丢失前置关系。
export function getProfileDialerProxyError(profile, nodes) {
    const bindings = profile?.dialerProxies;
    if (bindings == null) return '';
    if (!Array.isArray(bindings)) return 'invalid';
    if (!bindings.length) return '';
    if (profile.subconverter?.engineMode === 'external') return 'engine';
    const selected = new Set(profile.manualNodes || []);
    const enabled = new Set((nodes || []).filter((node) => node.enabled).map((node) => node.id));
    const links = new Map();
    for (const binding of bindings) {
        if (!binding?.nodeId || !binding?.viaNodeId) return 'invalid';
        if (
            ![binding.nodeId, binding.viaNodeId].every((id) => selected.has(id) && enabled.has(id))
        ) {
            return 'missing';
        }
        if (binding.nodeId === binding.viaNodeId) return 'self';
        if (links.has(binding.nodeId)) return 'duplicate';
        links.set(binding.nodeId, binding.viaNodeId);
    }
    for (const id of links.keys()) {
        const visited = new Set();
        let current = id;
        while (links.has(current)) {
            if (visited.has(current)) return 'cycle';
            visited.add(current);
            current = links.get(current);
        }
    }
    return '';
}

export const profileDialerProxyErrors = {
    engine: '已设置前置代理，请使用内置引擎',
    invalid: '前置代理配置格式无效',
    missing: '落地节点和前置节点都必须已启用，并被选入本订阅组；请恢复节点或清除对应前置设置',
    self: '节点不能将自身作为前置代理',
    duplicate: '同一节点只能配置一个前置代理',
    cycle: '前置代理存在循环引用，请调整后保存',
};
