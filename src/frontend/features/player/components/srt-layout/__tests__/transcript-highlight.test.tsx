import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { highlightSlice } from '../transcript-highlight';

describe('highlightSlice', () => {
    it('returns raw slice when query is empty or slice is empty', () => {
        expect(highlightSlice('Hello world', 'world', 6, '')).toBe('world');
        expect(highlightSlice('Hello world', 'world', 6, '   ')).toBe('world');
        expect(highlightSlice('Hello world', '', 0, 'test')).toBe('');
    });

    it('returns raw slice when there is no match in full text', () => {
        expect(highlightSlice('Hello world', 'world', 6, 'banana')).toBe('world');
    });

    it('returns raw slice when match in full text does not overlap this slice', () => {
        expect(highlightSlice('Hello world', 'world', 6, 'Hello')).toBe('world');
    });

    it('highlights full slice when query exactly matches slice', () => {
        const result = highlightSlice('Hello world', 'world', 6, 'world');
        const { container } = render(<div>{result}</div>);
        const mark = container.querySelector('mark');
        expect(mark).not.toBeNull();
        expect(mark?.textContent).toBe('world');
    });

    it('supports case-insensitive matching', () => {
        const result = highlightSlice('Hello World', 'World', 6, 'world');
        const { container } = render(<div>{result}</div>);
        const mark = container.querySelector('mark');
        expect(mark).not.toBeNull();
        expect(mark?.textContent).toBe('World');
    });

    it('highlights partial substring within a slice', () => {
        const result = highlightSlice('wonderful day', 'wonderful', 0, 'wonder');
        const { container } = render(<div>{result}</div>);
        const mark = container.querySelector('mark');
        expect(mark?.textContent).toBe('wonder');
        expect(container.textContent).toBe('wonderful');
    });

    it('highlights multi-word match that intersects slice boundary', () => {
        // fullText = "look at that", slice = "look" [0, 4], query = "look at" [0, 7]
        const result = highlightSlice('look at that', 'look', 0, 'look at');
        const { container } = render(<div>{result}</div>);
        const mark = container.querySelector('mark');
        expect(mark?.textContent).toBe('look');
    });

    it('highlights Chinese text accurately', () => {
        const result = highlightSlice('今天天气非常好', '今天天气非常好', 0, '天气');
        const { container } = render(<div>{result}</div>);
        const mark = container.querySelector('mark');
        expect(mark?.textContent).toBe('天气');
        expect(container.textContent).toBe('今天天气非常好');
    });

    it('applies prominent style when isActive is true', () => {
        const inactive = highlightSlice('apple pie', 'apple', 0, 'apple', false);
        const active = highlightSlice('apple pie', 'apple', 0, 'apple', true);

        const { container: inactiveContainer } = render(<div>{inactive}</div>);
        const { container: activeContainer } = render(<div>{active}</div>);

        expect(inactiveContainer.querySelector('mark')?.className).toContain('bg-amber-400/35');
        expect(activeContainer.querySelector('mark')?.className).toContain('bg-amber-500');
    });

    it('does not duplicate characters when pattern contains repeated characters', () => {
        const result = highlightSlice('aaaa', 'aaaa', 0, 'aa');
        const { container } = render(<div>{result}</div>);
        expect(container.textContent).toBe('aaaa');
        const marks = container.querySelectorAll('mark');
        expect(marks.length).toBe(2);
        expect(marks[0].textContent).toBe('aa');
        expect(marks[1].textContent).toBe('aa');
    });

    it('safely handles clamped slice start and out of bounds slices', () => {
        const result = highlightSlice('hello', 'hello', -5, 'll');
        const { container } = render(<div>{result}</div>);
        expect(container.textContent).toBe('hello');
    });
});
