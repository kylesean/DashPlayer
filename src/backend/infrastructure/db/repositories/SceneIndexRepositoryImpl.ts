import { and, eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Db } from '@/backend/infrastructure/db/createDb';
import { sceneIndex, type SceneIndexRow } from '@/backend/infrastructure/db/tables/sceneIndex';
import TYPES from '@/backend/ioc/types';
import type SceneIndexRepository from '@/backend/services/repositories/SceneIndexRepository';

/**
 * 场景切分索引 SQLite 仓储。
 */
@injectable()
export default class SceneIndexRepositoryImpl implements SceneIndexRepository {
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async find(fileHash: string, algorithmVersion: number): Promise<SceneIndexRow | null> {
        const rows = await this.db
            .select()
            .from(sceneIndex)
            .where(and(
                eq(sceneIndex.file_hash, fileHash),
                eq(sceneIndex.algorithm_version, algorithmVersion),
            ))
            .limit(1);
        return rows[0] ?? null;
    }

    public async upsert(value: {
        fileHash: string;
        algorithmVersion: number;
        inputHash: string;
        boundariesJson: string;
    }): Promise<void> {
        const now = new Date().toISOString();
        this.db.insert(sceneIndex)
            .values({
                file_hash: value.fileHash,
                algorithm_version: value.algorithmVersion,
                input_hash: value.inputHash,
                boundaries_json: value.boundariesJson,
                created_at: now,
                updated_at: now,
            })
            .onConflictDoUpdate({
                target: [sceneIndex.file_hash, sceneIndex.algorithm_version],
                set: {
                    input_hash: value.inputHash,
                    boundaries_json: value.boundariesJson,
                    updated_at: now,
                },
            })
            .run();
    }

    public async deleteByFile(fileHash: string): Promise<number> {
        const result = this.db.delete(sceneIndex).where(eq(sceneIndex.file_hash, fileHash)).run();
        return Number(result.changes);
    }
}
