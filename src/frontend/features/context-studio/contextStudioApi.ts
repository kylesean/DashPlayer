import { backendClient } from '@/frontend/infrastructure/electron/backendClient';
import type {
    ReaderDocumentSummary,
    SavedSentenceVO,
    SaveSentenceInput,
    UpdateSavedSentenceInput,
    WordContextOccurrence,
} from '@/common/types/contextStudio';

export const contextStudioApi = {
    async saveSentence(input: SaveSentenceInput): Promise<SavedSentenceVO> {
        return backendClient.call('context-studio/save-sentence', input);
    },

    async unsaveSentence(sentenceKey: string): Promise<boolean> {
        return backendClient.call('context-studio/unsave-sentence', { sentenceKey });
    },

    async listSavedSentences(): Promise<SavedSentenceVO[]> {
        return backendClient.call('context-studio/list-saved-sentences', undefined);
    },

    async listSavedKeys(videoId: string): Promise<string[]> {
        return backendClient.call('context-studio/list-saved-keys', { videoId });
    },

    async updateSavedSentence(input: UpdateSavedSentenceInput): Promise<SavedSentenceVO | null> {
        return backendClient.call('context-studio/update-saved-sentence', input);
    },

    async getWordContexts(word: string): Promise<WordContextOccurrence[]> {
        return backendClient.call('context-studio/get-word-contexts', { word });
    },

    async listReaderDocuments(): Promise<ReaderDocumentSummary[]> {
        return backendClient.call('context-studio/list-reader-documents', undefined);
    },
};
