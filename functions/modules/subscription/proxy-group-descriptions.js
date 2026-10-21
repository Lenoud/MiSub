import yaml from 'js-yaml';

const GROUP_LABELS = new Map([
    ['🚀 节点选择', '🚀 节点选择（手动选策略）'],
    ['🌍 总出口', '🌍 总出口（手动选策略）'],
    ['♻️ 自动选择', '♻️ 自动选择（低延迟优先）'],
    ['🔯 故障转移', '🔯 故障转移（首个可用）'],
    ['👋 手动切换', '👋 手动切换（固定单节点）'],
    ['🚀 常用节点', '🚀 常用节点（手动选策略）'],
    ['🔗 链式代理', '🔗 链式代理（选择落地出口）'],
    ['入口节点', '入口节点（选择前置跳板）'],
    ['🤖 智能 AI', '🤖 OpenAI 补充（登录验证等）'],
    ['🤖 OpenAI 补充服务', '🤖 OpenAI 补充（登录验证等）'],
    ['🤖 OpenAI', '🤖 OpenAI（ChatGPT 等）'],
    ['🤖 Claude', '🤖 Claude（Anthropic）'],
    ['🤖 Gemini', '🤖 Gemini（Google AI）'],
    ['🤖 Copilot', '🤖 Copilot（微软与 GitHub）'],
    ['🤖 Grok', '🤖 Grok（xAI）'],
    ['🤖 Perplexity', '🤖 Perplexity（AI 搜索）'],
    ['🤖 Mistral', '🤖 Mistral（对话与 API）'],
    ['🤖 DeepSeek', '🤖 DeepSeek（对话与 API）'],
    ['🤖 AI 平台', '🤖 AI 聚合与开发（Poe 等）'],
    ['🤖 AI 聚合与开发平台', '🤖 AI 聚合与开发（Poe 等）'],
    ['🎬 视频广告', '🛑 广告拦截（拦截或放行）'],
    ['🎥 流媒体', '🎥 Netflix（独立选出口）'],
    ['🍎 Apple', '🍎 Apple（直连或代理）'],
    ['Ⓜ️ Microsoft', 'Ⓜ️ Microsoft（直连或代理）'],
    ['📲 Telegram', '📲 Telegram（独立选出口）'],
    ['🎧 Spotify', '🎧 Spotify（独立选出口）'],
    ['🎮 游戏平台', '🎮 游戏平台（独立选出口）'],
]);

const OPTIONAL_SERVICE_GROUPS = new Set(['📲 Telegram', '🎧 Spotify', '🎮 游戏平台']);
const COMMON_GROUP_TYPES = new Map([
    ['🚀 节点选择', 'select'],
    ['🌍 总出口', 'select'],
    ['♻️ 自动选择', 'url-test'],
    ['🔯 故障转移', 'fallback'],
    ['👋 手动切换', 'select'],
    ['🚀 常用节点', 'select'],
    ['🔗 链式代理', 'select'],
    ['入口节点', 'select'],
]);

function describeGroup(group, referencedGroups, builtinRules) {
    // 隐藏的 DNS 和地区测速组保留原名，减少客户端缓存和 DNS 选择器的变化。
    if (group.hidden) return group.name;
    const commonType = COMMON_GROUP_TYPES.get(group.name);
    if (commonType) return group.type === commonType ? GROUP_LABELS.get(group.name) : group.name;
    if (group.type === 'select' && /^\p{Regional_Indicator}{2}\s.+节点$/u.test(group.name)) {
        return `${group.name}（${builtinRules ? '区内自动/手动' : '区内选出口'}）`;
    }
    // 自定义模板的服务范围由作者定义，不能把“流媒体”等组一律解释成 Netflix。
    if (!builtinRules) return group.name;
    if (OPTIONAL_SERVICE_GROUPS.has(group.name) && !referencedGroups.has(group.name)) {
        return `${group.name}（未绑定规则）`;
    }
    if (GROUP_LABELS.has(group.name)) return GROUP_LABELS.get(group.name);
    return group.name;
}

/**
 * 为 Clash 输出添加可见的简短说明，并同步规则、组成员与前置代理引用。
 * 只在最终输出阶段改显示名称，避免干扰模板解析、地区识别和链路展开。
 */
export function addClashProxyGroupDescriptions(content, { builtinRules = true } = {}) {
    const config = yaml.load(content);
    if (!config || !Array.isArray(config['proxy-groups'])) return content;

    const groups = config['proxy-groups'];
    const referencedGroups = new Set([
        ...(config.rules || []).flatMap((rule) => String(rule).split(',')),
        ...groups.flatMap((group) => group.proxies || []),
    ]);
    const occupiedNames = new Set([
        ...groups.map((group) => group.name),
        ...(config.proxies || []).map((proxy) => proxy.name),
    ]);
    const names = new Map();
    for (const group of groups) {
        const label = describeGroup(group, referencedGroups, builtinRules);
        if (label === group.name || occupiedNames.has(label)) continue;
        names.set(group.name, label);
        occupiedNames.add(label);
    }
    if (names.size === 0) return content;

    const rename = (name) => names.get(name) || name;
    config['proxy-groups'] = groups.map((group) => ({
        ...group,
        name: rename(group.name),
        ...(Array.isArray(group.proxies) ? { proxies: group.proxies.map(rename) } : {}),
    }));
    config.rules = (config.rules || []).map((rule) =>
        String(rule).split(',').map(rename).join(',')
    );
    config.proxies = (config.proxies || []).map((proxy) =>
        proxy['dialer-proxy'] ? { ...proxy, 'dialer-proxy': rename(proxy['dialer-proxy']) } : proxy
    );
    for (const key of ['proxy-providers', 'rule-providers']) {
        for (const provider of Object.values(config[key] || {})) {
            if (provider.proxy) provider.proxy = rename(provider.proxy);
        }
    }
    for (const tunnel of config.tunnels || []) {
        if (tunnel.proxy) tunnel.proxy = rename(tunnel.proxy);
    }

    const renameDnsSelectors = (value) => {
        if (Array.isArray(value)) return value.map(renameDnsSelectors);
        if (value && typeof value === 'object') {
            return Object.fromEntries(
                Object.entries(value).map(([key, entry]) => [key, renameDnsSelectors(entry)])
            );
        }
        if (typeof value !== 'string' || !value.includes('#')) return value;
        const separator = value.lastIndexOf('#');
        const [selector, ...flags] = value.slice(separator + 1).split('&');
        const label = rename(selector);
        return label === selector
            ? value
            : `${value.slice(0, separator + 1)}${[label, ...flags].join('&')}`;
    };
    if (config.dns) config.dns = renameDnsSelectors(config.dns);

    // 保留 Stash 的 #SUBSCRIBED 等首部注释。
    const header = String(content).match(/^(?:[ \t]*#[^\n]*(?:\n|$)|[ \t]*\r?\n)*/)?.[0] || '';
    return header + yaml.dump(config, { indent: 2, lineWidth: -1, noRefs: true });
}
