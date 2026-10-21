import { describe, expect, it, vi } from 'vitest';
import { migrateStoredProfileIds } from '../../functions/modules/profile-id-migration.js';

function adapter(type = 'd1') {
    return {
        type,
        put: vi.fn().mockResolvedValue(true),
        putProfile: vi.fn().mockResolvedValue(true),
        deleteProfileById: vi.fn().mockResolvedValue(true),
    };
}

describe('旧版订阅组 ID 的存储迁移', () => {
    it('D1 迁移写入新行并清除旧 ID 及主行，读取时不再生成旧结构', async () => {
        const storage = adapter();
        const input = [{ id: 'profile_abc', name: 'Edge', manualNodes: ['node-1'] }];
        const migrated = await migrateStoredProfileIds(storage, input);
        expect(migrated).toEqual([{ ...input[0], id: 'abc' }]);
        expect(input[0].id).toBe('profile_abc');
        expect(storage.putProfile).toHaveBeenCalledWith(migrated[0]);
        expect(storage.deleteProfileById).toHaveBeenCalledWith('profile_abc');
        expect(storage.deleteProfileById).toHaveBeenCalledWith('main');
        expect(storage.put).not.toHaveBeenCalled();
        expect(storage.putProfile.mock.invocationCallOrder[0]).toBeLessThan(
            storage.deleteProfileById.mock.invocationCallOrder[0]
        );
    });

    it('保留已迁移记录的后续修改，并合并重复副本', async () => {
        const storage = adapter();
        const current = { id: 'abc', name: '新名称', manualNodes: ['node-2'] };
        const migrated = await migrateStoredProfileIds(storage, [
            { id: 'profile_abc', name: '旧名称' },
            current,
        ]);
        expect(migrated).toEqual([current]);
        expect(storage.putProfile).toHaveBeenCalledExactlyOnceWith(current);
    });

    it('新行写入失败时保留所有旧行', async () => {
        const storage = adapter();
        storage.putProfile.mockRejectedValue(new Error('写入失败'));
        await expect(migrateStoredProfileIds(storage, [{ id: 'profile_abc' }])).rejects.toThrow(
            '写入失败'
        );
        expect(storage.deleteProfileById).not.toHaveBeenCalled();
    });

    it('KV 保持全量数组存储格式', async () => {
        const storage = adapter('kv');
        await migrateStoredProfileIds(storage, [{ id: 'profile_abc', name: 'Edge' }]);
        expect(storage.put).toHaveBeenCalledExactlyOnceWith('misub_profiles_v1', [
            { id: 'abc', name: 'Edge' },
        ]);
        expect(storage.putProfile).not.toHaveBeenCalled();
        expect(storage.deleteProfileById).not.toHaveBeenCalled();
    });

    it('重复读取新 ID 时不执行写操作', async () => {
        const storage = adapter();
        const profiles = [{ id: 'abc' }];
        expect(await migrateStoredProfileIds(storage, profiles)).toBe(profiles);
        expect(storage.putProfile).not.toHaveBeenCalled();
        expect(storage.put).not.toHaveBeenCalled();
    });
});
