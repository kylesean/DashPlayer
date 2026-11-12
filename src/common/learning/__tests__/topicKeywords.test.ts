import { describe, expect, it } from 'vitest';

import {
    extractKeywordTerms,
    extractTopicKeywords,
    MAX_TOPIC_KEYWORDS,
} from '@/common/learning/topicKeywords';

describe('extractKeywordTerms', () => {
    it('去掉标点、重复词与停用词', () => {
        expect(extractKeywordTerms('The journey, the journey home!')).toEqual(['journey', 'home']);
    });
});

describe('extractTopicKeywords', () => {
    it('选出本主题常见、其它主题少见的词', () => {
        const result = extractTopicKeywords([
            {
                key: 'journey',
                texts: [
                    'It was a long journey home.',
                    'The journey took twelve hours.',
                    'Journey was exhausting but worth it.',
                ],
            },
            {
                key: 'kitchen',
                texts: [
                    'She chopped onions in the kitchen.',
                    'The kitchen smelled of garlic.',
                    'Dinner was ready in the kitchen.',
                ],
            },
        ]);

        expect(result.get('journey')).toContain('journey');
        expect(result.get('kitchen')).toContain('kitchen');
        // 一个主题的关键词不能混进另一个主题。
        expect(result.get('journey')).not.toContain('kitchen');
    });

    it('到处都出现的词不会成为关键词', () => {
        const result = extractTopicKeywords([
            { key: 'a', texts: ['really good stuff', 'really good food', 'really good day'] },
            { key: 'b', texts: ['really good movie', 'really good book', 'really good show'] },
        ]);
        // 每个词都横跨所有主题时，没有任何词能区分它们：宁可不给关键词，
        // 也不要拿 "really / good" 冒充这组词的共同点。
        expect(result.has('a')).toBe(false);
        expect(result.has('b')).toBe(false);
    });

    it('只出现一次的词证据不足，不当关键词', () => {
        const result = extractTopicKeywords([
            { key: 'a', texts: ['unique mention here', 'another ordinary line', 'third ordinary line'] },
        ]);
        expect(result.get('a') ?? []).not.toContain('unique');
    });

    it('每个主题最多 3 个关键词', () => {
        const texts = Array.from({ length: 5 }, (_, i) => `alpha beta gamma delta epsilon line${i}`);
        const result = extractTopicKeywords([{ key: 'a', texts }]);
        expect(result.get('a')!.length).toBeLessThanOrEqual(MAX_TOPIC_KEYWORDS);
    });

    it('同一份数据永远得到同一组关键词', () => {
        const inputs = [
            { key: 'a', texts: ['alpha beta', 'alpha beta', 'gamma delta', 'gamma delta'] },
            { key: 'b', texts: ['one two', 'one two'] },
        ];
        expect(Array.from(extractTopicKeywords(inputs))).toEqual(Array.from(extractTopicKeywords(inputs)));
    });

    it('没有语境文本的主题不产出关键词', () => {
        expect(extractTopicKeywords([{ key: 'empty', texts: [] }]).has('empty')).toBe(false);
    });
});
