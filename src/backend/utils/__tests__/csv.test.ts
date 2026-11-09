import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/backend/utils/csv';

describe('CSV 解析器', () => {
    it('按逗号切分普通行', () => {
        expect(parseCsv('word,translate\napple,苹果')).toEqual([
            ['word', 'translate'],
            ['apple', '苹果'],
        ]);
    });

    it('双引号包裹的字段保留其中的逗号', () => {
        expect(parseCsv('"hello, world","say ""hi"""')).toEqual([
            ['hello, world', 'say "hi"'],
        ]);
    });

    it('转义的双引号还原成一个引号', () => {
        expect(parseCsv('"a""b",c')).toEqual([['a"b', 'c']]);
    });

    it('双引号里的换行按字面量保留', () => {
        expect(parseCsv('"line1\nline2",x')).toEqual([['line1\nline2', 'x']]);
    });

    it('CRLF 换行不会把回车留在字段里', () => {
        expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
            ['a', 'b'],
            ['c', 'd'],
        ]);
    });

    it('LF 换行同样被支持', () => {
        expect(parseCsv('a,b\nc,d')).toEqual([
            ['a', 'b'],
            ['c', 'd'],
        ]);
    });

    it('剥掉开头的 UTF-8 BOM', () => {
        expect(parseCsv('\uFEFFword,translate\napple,苹果')).toEqual([
            ['word', 'translate'],
            ['apple', '苹果'],
        ]);
    });

    it('结尾的换行不会多出一行空记录', () => {
        expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
        expect(parseCsv('a,b\r\n')).toEqual([['a', 'b']]);
    });

    it('没有结尾换行时最后一行照样被解析出来', () => {
        expect(parseCsv('a,b')).toEqual([['a', 'b']]);
    });

    it('空内容返回空数组', () => {
        expect(parseCsv('')).toEqual([]);
    });
});
