import { z } from 'zod';
import type Controller from '@/backend/controllers/Controller';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import type TagService from '@/backend/services/TagService';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import { nonEmptyStringSchema, positiveIntSchema } from '@/backend/controllers/ipc/routeSchemas';
import type { Tag } from '@/common/contracts/tag';
import type { FavouriteClipsService } from '@/backend/services/FavouriteClipsService';

/**
 * 收藏标签管理 IPC 控制器。
 */
@injectable()
export default class TagController implements Controller {
    /**
     * 构造标签控制器。
     *
     * @param tagService 标签业务服务。
     * @param favouriteClipsService 收藏片段服务。
     */
    constructor(
        @inject(TYPES.TagService) private readonly tagService: TagService,
        @inject(TYPES.FavouriteClips) private readonly favouriteClipsService: FavouriteClipsService,
    ) {}

    public async addTag(name: string): Promise<Tag> {
        return this.tagService.addTag(name);
    }

    public async deleteTag(id: number): Promise<void> {
        return this.tagService.deleteTag(id);
    }

    public async updateTag({ id, name }: { id: number, name: string }) {
        return this.favouriteClipsService.renameTag(id, name);
    }

    public async search(keyword: string): Promise<Tag[]> {
        return this.tagService.search(keyword);
    }

    registerRoutes(): void {
        registerRoute('tag/add', (p) => this.addTag(p), {
            schema: nonEmptyStringSchema,
        });
        registerRoute('tag/delete', (p) => this.deleteTag(p), {
            schema: positiveIntSchema,
        });
        registerRoute('tag/update', (p) => this.updateTag(p), {
            schema: z.object({
                id: positiveIntSchema,
                name: nonEmptyStringSchema,
            }),
        });
        registerRoute('tag/search', (p) => this.search(p), {
            schema: z.string(),
        });
    }

}
