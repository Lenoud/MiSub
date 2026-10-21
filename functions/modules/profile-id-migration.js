import { KV_KEY_PROFILES } from './config.js';

/** 迁移旧 ID 时沿用当前存储格式，避免在 D1 中重新写入旧主行。 */
export async function migrateStoredProfileIds(storageAdapter, profiles) {
    if (!Array.isArray(profiles)) return [];
    const legacy = profiles.filter((profile) => profile.id?.startsWith('profile_'));
    if (legacy.length === 0) return profiles;

    // 已存在的新 ID 记录优先，防止陈旧副本覆盖用户后续修改。
    const canonical = new Map(
        profiles
            .filter((profile) => !profile.id?.startsWith('profile_'))
            .map((profile) => [profile.id, profile])
    );
    for (const profile of legacy) {
        const id = profile.id.slice('profile_'.length);
        if (!id) throw new Error('旧版订阅组 ID 为空，停止迁移');
        if (!canonical.has(id)) canonical.set(id, { ...profile, id });
    }
    const migrated = [...canonical.values()];
    if (storageAdapter.type === 'd1') {
        // 全部新行写成功后才清理旧行，写入失败时保留原始数据。
        await Promise.all(migrated.map((profile) => storageAdapter.putProfile(profile)));
        await Promise.all(legacy.map((profile) => storageAdapter.deleteProfileById(profile.id)));
        await storageAdapter.deleteProfileById('main');
    } else {
        await storageAdapter.put(KV_KEY_PROFILES, migrated);
    }
    return migrated;
}
