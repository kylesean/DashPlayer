import { describe, expect, it } from 'vitest';
import {
    assertVocabularyPath,
    MAX_VOCABULARY_FILE_SIZE_BYTES,
} from '@/backend/utils/file-path-guard';

describe('词汇表文件路径校验', () => {
    it('接受 .xlsx 与 .csv', () => {
        expect(() => assertVocabularyPath('/tmp/word.xlsx')).not.toThrow();
        expect(() => assertVocabularyPath('/tmp/word.csv')).not.toThrow();
    });

    it('扩展名大小写不敏感', () => {
        expect(() => assertVocabularyPath('/tmp/word.XLSX')).not.toThrow();
        expect(() => assertVocabularyPath('/tmp/word.CSV')).not.toThrow();
    });

    it('拒绝 .xlsx.exe 这类伪装扩展名', () => {
        expect(() => assertVocabularyPath('/tmp/word.xlsx.exe')).toThrow();
    });

    it('拒绝 .txt 等非表格文件', () => {
        expect(() => assertVocabularyPath('/tmp/word.txt')).toThrow();
    });

    it('拒绝读不了的旧版 .xls', () => {
        expect(() => assertVocabularyPath('/tmp/word.xls')).toThrow();
    });

    it('报错信息说明支持哪些格式', () => {
        expect(() => assertVocabularyPath('/tmp/word.txt')).toThrow('.xlsx');
        expect(() => assertVocabularyPath('/tmp/word.txt')).toThrow('.csv');
        expect(() => assertVocabularyPath('/tmp/word.xls')).toThrow('.xlsx');
        expect(() => assertVocabularyPath('/tmp/word.xls')).toThrow('.csv');
    });

    it('体积超限时拒绝导入', () => {
        expect(() => assertVocabularyPath('/tmp/word.xlsx', MAX_VOCABULARY_FILE_SIZE_BYTES + 1)).toThrow('MB');
        expect(() => assertVocabularyPath('/tmp/word.xlsx', MAX_VOCABULARY_FILE_SIZE_BYTES)).not.toThrow();
    });
});
