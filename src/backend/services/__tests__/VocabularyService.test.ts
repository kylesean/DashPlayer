import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-vocabulary-test-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import { Workbook } from 'exceljs';
import type { Worksheet } from 'exceljs';
import { parseImportedWords } from '@/backend/services/VocabularySpreadsheet';
import { VocabularyServiceImpl } from '@/backend/services/VocabularyService';
import { normalizeCellValue } from '@/backend/utils/spreadsheet-cell';
import type AiProviderService from '@/backend/services/AiProviderService';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type SubtitleService from '@/backend/services/SubtitleService';
import type { VideoLearningService } from '@/backend/services/VideoLearningService';
import type { WordMatchService } from '@/backend/services/WordMatchService';
import type VideoLearningClipWordRepository from '@/backend/services/repositories/VideoLearningClipWordRepository';
import type ReviewCardRepository from '@/backend/services/repositories/ReviewCardRepository';
import type WordsRepository from '@/backend/services/repositories/WordsRepository';

/**
 * 落库的单词行。
 */
interface StoredWord {
    word: string;
    translate: string | null;
    created_at: string;
    updated_at: string;
}

/**
 * 装配只保留词汇表导入/导出所需能力的服务替身。
 *
 * @param fileContent 交给文件网关返回的文件内容。
 * @param existingWords 仓储里已有的单词。
 */
const buildService = (options: { fileContent: Buffer; existingWords?: StoredWord[] }) => {
    const stored: StoredWord[] = [];
    const fileSystemGateway = {
        getFileSize: vi.fn(async () => options.fileContent.length),
        readBinaryFile: vi.fn(async () => options.fileContent),
    } as unknown as FileSystemGateway;

    const wordsRepository = {
        getAll: vi.fn(async () => options.existingWords ?? []),
        replaceAll: vi.fn(async (values: StoredWord[]) => {
            stored.push(...values);
        }),
    } as unknown as WordsRepository;

    const reviewCardRepository = {
        deleteByWord: vi.fn(),
        ensureForWords: vi.fn(),
        deleteOrphans: vi.fn(),
    } as unknown as ReviewCardRepository;

    const service = new VocabularyServiceImpl(
        {
            syncFromOss: vi.fn(async () => undefined),
            invalidateClipAnalysisCache: vi.fn(),
        } as unknown as VideoLearningService,
        wordsRepository,
        reviewCardRepository,
        { invalidateVocabularyCache: vi.fn() } as unknown as WordMatchService,
        {} as unknown as AiProviderService,
        {} as unknown as VideoLearningClipWordRepository,
        { invalidateVocabularyAnalysisCache: vi.fn() } as unknown as SubtitleService,
        {} as unknown as StorageDirectoryProvider,
        fileSystemGateway,
    );

    return { service, stored, fileSystemGateway, reviewCardRepository };
};

/**
 * 构造 xlsx 测试文件。
 *
 * @param build 工作表内容构造函数。
 */
const buildXlsx = async (build: (worksheet: Worksheet) => void): Promise<Buffer> => {
    const workbook = new Workbook();
    build(workbook.addWorksheet('单词管理'));
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
};

/**
 * 读取 xlsx 测试文件。
 */
const readXlsx = async (content: Buffer): Promise<Workbook> => {
    const workbook = new Workbook();
    await workbook.xlsx.load(content as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    return workbook;
};

/**
 * 取出批注文本。
 */
const noteText = (note: unknown): string => {
    if (typeof note === 'string') {
        return note;
    }
    if (note && typeof note === 'object') {
        const texts = (note as { texts?: Array<{ text?: string }> }).texts ?? [];
        return texts.map((item) => item.text ?? '').join('');
    }
    return '';
};

describe('导入词表解析', () => {
    it('英文列支持 英文 / word / Word 三种列名', () => {
        expect(parseImportedWords([['英文', '释义'], ['apple', '苹果']])).toHaveLength(1);
        expect(parseImportedWords([['word', 'translate'], ['apple', '苹果']])).toHaveLength(1);
        expect(parseImportedWords([['Word', 'Translation'], ['apple', '苹果']])).toHaveLength(1);
    });

    it('释义列支持 释义 / translate / Translation 三种列名', () => {
        const rows = parseImportedWords([['英文', '释义'], ['apple', '苹果']]);
        expect(rows[0].translate).toBe('苹果');

        const translated = parseImportedWords([['word', 'translate'], ['apple', '苹果']]);
        expect(translated[0].translate).toBe('苹果');

        const translation = parseImportedWords([['Word', 'Translation'], ['apple', '苹果']]);
        expect(translation[0].translate).toBe('苹果');
    });

    it('英文列为空的行被跳过', () => {
        const rows = parseImportedWords([
            ['英文', '释义'],
            ['apple', '苹果'],
            ['', '孤儿释义'],
            ['   ', '空白释义'],
            ['banana', '香蕉'],
        ]);

        expect(rows.map((item) => item.word)).toEqual(['apple', 'banana']);
    });

    it('单词统一小写并去掉首尾空白', () => {
        const rows = parseImportedWords([['英文', '释义'], ['  Apple  ', '苹果']]);

        expect(rows[0].word).toBe('apple');
    });

    it('大小写变体只保留一条，后出现的覆盖前面的', () => {
        const rows = parseImportedWords([
            ['英文', '释义'],
            ['Apple', '苹果'],
            ['APPLE', '青苹果'],
        ]);

        expect(rows).toHaveLength(1);
        expect(rows[0].word).toBe('apple');
        expect(rows[0].translate).toBe('青苹果');
    });

    it('释义为空时记为 null', () => {
        const rows = parseImportedWords([['英文', '释义'], ['apple', '']]);

        expect(rows[0].translate).toBeNull();
    });

    it('结果带上创建与更新时间', () => {
        const rows = parseImportedWords([['英文', '释义'], ['apple', '苹果']]);

        expect(typeof rows[0].created_at).toBe('string');
        expect(rows[0].updated_at).toBe(rows[0].created_at);
    });

    it('空表格返回空列表', () => {
        expect(parseImportedWords([])).toEqual([]);
    });
});

describe('单元格值归一化', () => {
    it('富文本单元格被摊平成纯文本', () => {
        expect(normalizeCellValue({ richText: [{ text: 'hello' }] })).toBe('hello');
    });

    it('多个富文本片段按顺序拼接', () => {
        expect(normalizeCellValue({ richText: [{ text: 'he' }, { text: 'llo' }] })).toBe('hello');
    });

    it('带 text 的对象取其文本', () => {
        expect(normalizeCellValue({ text: 'hello' })).toBe('hello');
    });

    it('公式取计算结果', () => {
        expect(normalizeCellValue({ formula: 'SUM(A1:A2)', result: 42 })).toBe('42');
    });

    it('普通字符串、数字与布尔值转成文本', () => {
        expect(normalizeCellValue('hello')).toBe('hello');
        expect(normalizeCellValue(42)).toBe('42');
        expect(normalizeCellValue(true)).toBe('true');
    });

    it('空值与未知结构返回空字符串', () => {
        expect(normalizeCellValue(null)).toBe('');
        expect(normalizeCellValue(undefined)).toBe('');
        expect(normalizeCellValue({})).toBe('');
    });
});

describe('词汇表导入', () => {
    it('导入 xlsx 只认第一个工作表', async () => {
        const content = await buildXlsx((worksheet) => {
            worksheet.addRow(['英文', '释义']);
            worksheet.addRow(['apple', '苹果']);
        });

        const workbook = new Workbook();
        await workbook.xlsx.load(content as unknown as Parameters<typeof workbook.xlsx.load>[0]);
        const second = workbook.addWorksheet('默认词表');
        second.addRow(['英文', '释义']);
        second.addRow(['banana', '香蕉']);
        const full = Buffer.from(await workbook.xlsx.writeBuffer());

        const { service, stored } = buildService({ fileContent: full });
        const result = await service.importWords('/tmp/word.xlsx');

        expect(result.success).toBe(true);
        expect(stored.map((item) => item.word)).toEqual(['apple']);
    });

    it('导入 csv 与导入 xlsx 结果一致', async () => {
        const csv = Buffer.from('英文,释义\napple,苹果\nbanana,香蕉\n', 'utf-8');
        const { service, stored } = buildService({ fileContent: csv });
        const result = await service.importWords('/tmp/word.csv');

        expect(result.success).toBe(true);
        expect(stored.map((item) => item.word)).toEqual(['apple', 'banana']);
        expect(stored[0].translate).toBe('苹果');
    });

    it('导入的单词同时进入复习队列', async () => {
        const csv = Buffer.from('英文,释义\napple,苹果\nbanana,香蕉\n', 'utf-8');
        const { service, reviewCardRepository } = buildService({ fileContent: csv });

        await service.importWords('/tmp/word.csv');

        expect(reviewCardRepository.ensureForWords).toHaveBeenCalledWith(
            ['apple', 'banana'],
            expect.any(String),
        );
        expect(reviewCardRepository.deleteOrphans).toHaveBeenCalled();
    });

    it('富文本单元格也能被导入成单词', async () => {
        const content = await buildXlsx((worksheet) => {
            worksheet.addRow(['英文', '释义']);
            worksheet.getCell('A2').value = { richText: [{ text: 'hello' }] };
            worksheet.getCell('B2').value = { richText: [{ text: '你好' }] };
        });

        const { service, stored } = buildService({ fileContent: content });
        const result = await service.importWords('/tmp/word.xlsx');

        expect(result.success).toBe(true);
        expect(stored[0].word).toBe('hello');
        expect(stored[0].translate).toBe('你好');
    });

    it('扩展名不合法时直接拒绝，连文件都不读', async () => {
        const { service, stored, fileSystemGateway } = buildService({
            fileContent: Buffer.from('任意内容', 'utf-8'),
        });
        const result = await service.importWords('/tmp/secret.txt');

        expect(result.success).toBe(false);
        expect(result.error).toContain('.xlsx');
        expect(result.error).toContain('.csv');
        expect(fileSystemGateway.readBinaryFile).not.toHaveBeenCalled();
        expect(stored).toHaveLength(0);
    });

    it('旧版 .xls 给出可操作的提示', async () => {
        const { service, fileSystemGateway } = buildService({
            fileContent: Buffer.from('任意内容', 'utf-8'),
        });
        const result = await service.importWords('/tmp/word.xls');

        expect(result.success).toBe(false);
        expect(result.error).toContain('.xls');
        expect(result.error).toContain('.xlsx');
        expect(fileSystemGateway.readBinaryFile).not.toHaveBeenCalled();
    });

    it('伪装成表格的扩展名同样被拒绝', async () => {
        const { service } = buildService({ fileContent: Buffer.from('任意内容', 'utf-8') });
        const result = await service.importWords('/tmp/word.xlsx.exe');

        expect(result.success).toBe(false);
    });

    it('空文件直接报错，不去清空已有词表', async () => {
        const { service, stored } = buildService({ fileContent: Buffer.alloc(0) });
        const result = await service.importWords('/tmp/word.csv');

        expect(result.success).toBe(false);
        expect(result.error).toContain('空');
        expect(stored).toHaveLength(0);
    });
});

describe('模板导出', () => {
    it('导出两个工作表，保持列名、列宽与恢复说明', async () => {
        const { service } = buildService({
            fileContent: Buffer.alloc(0),
            existingWords: [
                { word: 'apple', translate: '苹果', created_at: '', updated_at: '' },
            ],
        });

        const result = await service.exportTemplate();
        expect(result.success).toBe(true);

        const workbook = await readXlsx(Buffer.from(result.data as string, 'base64'));
        expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['单词管理', '默认词表']);

        const sheet = workbook.worksheets[0];
        expect(sheet.getCell('A1').value).toBe('英文');
        expect(sheet.getCell('B1').value).toBe('释义');
        expect(sheet.getCell('A2').value).toBe('apple');
        expect(sheet.getCell('B2').value).toBe('苹果');
        expect(sheet.getColumn(1).width).toBe(25);
        expect(sheet.getColumn(2).width).toBe(50);

        const defaultSheet = workbook.worksheets[1];
        expect(defaultSheet.getCell('A1').value).toBe('英文');
        expect(defaultSheet.getCell('D1').value).toBe('恢复说明');
        expect(noteText(defaultSheet.getCell('D1').note)).toContain('恢复默认词表');
        expect(defaultSheet.getColumn(4).width).toBe(12);
    });

    it('导出的模板能原样被导入回来', async () => {
        const { service } = buildService({
            fileContent: Buffer.alloc(0),
            existingWords: [
                { word: 'apple', translate: '苹果', created_at: '', updated_at: '' },
            ],
        });

        const exported = await service.exportTemplate();
        const content = Buffer.from(exported.data as string, 'base64');

        const importer = buildService({ fileContent: content });
        const result = await importer.service.importWords('/tmp/template.xlsx');

        expect(result.success).toBe(true);
        expect(importer.stored.map((item) => item.word)).toContain('apple');
        expect(importer.stored.find((item) => item.word === 'apple')?.translate).toBe('苹果');
    });
});
