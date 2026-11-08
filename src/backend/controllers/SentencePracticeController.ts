import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import TYPES from '@/backend/ioc/types';
import type SentencePracticeService from '@/backend/services/SentencePracticeService';

/**
 * 句子练习 IPC 控制器:注册 practice/* 路径,参数整理与转发到 SentencePracticeService。
 */
@injectable()
export default class SentencePracticeController implements Controller {
    @inject(TYPES.SentencePracticeService)
    private sentencePracticeService!: SentencePracticeService;

    registerRoutes(): void {
        registerRoute('practice/score-shadowing', (p) => this.sentencePracticeService.scoreShadowing(p));
        registerRoute('practice/score-dictation', (p) => this.sentencePracticeService.scoreDictation(p));
        registerRoute('practice/list-by-sentence', (p) => this.sentencePracticeService.listBySentence(p));
    }
}
