import { describe, expect, it } from 'vitest';
import { ipaToPhonemeTokens, logSoftmaxFrames, scoreWordsWithCtcGop } from '@/common/utils/practice/phonemeGop';

const VOCAB: Record<string, number> = {
    '<pad>': 0,
    '<s>': 1,
    '</s>': 2,
    '<unk>': 3,
    'θ': 4,
    's': 5,
    'ɪ': 6,
    'ŋ': 7,
    'k': 8,
};

describe('phonemeGop', () => {
    it('ipaToPhonemeTokens 正确拆分 IPA 音标并过滤重音符号', () => {
        expect(ipaToPhonemeTokens('/ˈθɪŋk/', VOCAB)).toEqual(['θ', 'ɪ', 'ŋ', 'k']);
    });

    it('CTC 强制对齐与 GOP 准确区分清晰音素与偏音音素', () => {
        const numFrames = 8;
        const vocabSize = 9;
        const logits = new Float32Array(numFrames * vocabSize).fill(-4);
        // 期望词 think: θ ɪ ŋ k，但前两帧模型在 's'(5) 上后验远高于 'θ'(4)
        logits[0 * vocabSize + 5] = 4; // 错读成 s
        logits[1 * vocabSize + 5] = 4;
        logits[2 * vocabSize + 6] = 4; // ɪ
        logits[3 * vocabSize + 6] = 4;
        logits[4 * vocabSize + 7] = 4; // ŋ
        logits[5 * vocabSize + 7] = 4;
        logits[6 * vocabSize + 8] = 4; // k
        logits[7 * vocabSize + 8] = 4;

        const logProbs = logSoftmaxFrames(logits, numFrames, vocabSize);
        const outputs = scoreWordsWithCtcGop(logProbs, numFrames, vocabSize, VOCAB, [
            { wordIndex: 0, phonemes: ['θ', 'ɪ', 'ŋ', 'k'] },
        ]);

        expect(outputs).toHaveLength(1);
        const [wordOut] = outputs;
        expect(wordOut.phonemes[0].ipa).toBe('θ');
        expect(wordOut.phonemes[0].status).toBe('error');
        expect(wordOut.phonemes[0].heardIpa).toBe('s');
        expect(wordOut.phonemes[1].status).toBe('ok');
        expect(wordOut.phonemes[2].status).toBe('ok');
        expect(wordOut.phonemes[3].status).toBe('ok');
    });
});
