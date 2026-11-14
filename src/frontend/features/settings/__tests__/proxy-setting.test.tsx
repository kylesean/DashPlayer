import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import ProxySetting from '@/frontend/features/settings/ProxySetting';

const KEY = 'settings/proxy/detail';

const originalPointerMethods = {
    hasPointerCapture: HTMLElement.prototype.hasPointerCapture,
    setPointerCapture: HTMLElement.prototype.setPointerCapture,
    releasePointerCapture: HTMLElement.prototype.releasePointerCapture,
    scrollIntoView: HTMLElement.prototype.scrollIntoView,
};

beforeAll(() => {
    if (typeof window !== 'undefined') {
        HTMLElement.prototype.hasPointerCapture = () => false;
        HTMLElement.prototype.setPointerCapture = () => {};
        HTMLElement.prototype.releasePointerCapture = () => {};
        HTMLElement.prototype.scrollIntoView = () => {};
    }
});

afterAll(() => {
    if (typeof window !== 'undefined') {
        HTMLElement.prototype.hasPointerCapture = originalPointerMethods.hasPointerCapture;
        HTMLElement.prototype.setPointerCapture = originalPointerMethods.setPointerCapture;
        HTMLElement.prototype.releasePointerCapture = originalPointerMethods.releasePointerCapture;
        HTMLElement.prototype.scrollIntoView = originalPointerMethods.scrollIntoView;
    }
});

afterEach(() => cleanup());

/** 代理模式分段控件里的某个档位。 */
const findModeRadio = async (name: string) => {
    const group = await screen.findByRole('radiogroup', { name: 'proxy.modeTitle' }, { timeout: 3000 });
    return within(group).getByRole('radio', { name });
};

const renderPage = () => {
    return render(
        <SWRConfig value={{ provider: () => new Map() }}>
            <ProxySetting />
        </SWRConfig>
    );
};

describe('ProxySetting（SWR 版本）', () => {
    it('detail 返回 custom 时页面显示“自定义”', async () => {
        const calls: unknown[] = [];
        window.electron = {
            call: vi.fn((path: string, params: unknown) => {
                if (path === KEY) return Promise.resolve({ mode: 'custom', url: '', bypassRules: '' });
                if (path === 'settings/proxy/save') calls.push(params);
                return Promise.resolve(undefined);
            }),
        } as never;

        renderPage();
        expect(await findModeRadio('proxy.modeCustom')).toBeChecked();
        expect(calls).toHaveLength(0);
    });

    it('detail 返回 none 时页面显示“没有代理”', async () => {
        window.electron = {
            call: vi.fn((path: string) => {
                if (path === KEY) return Promise.resolve({ mode: 'none', url: '', bypassRules: '' });
                return Promise.resolve(undefined);
            }),
        } as never;

        renderPage();
        expect(await findModeRadio('proxy.modeNone')).toBeChecked();
    });

    it('system 模式未探测到系统代理时显示直连警告', async () => {
        window.electron = {
            call: vi.fn((path: string) => {
                if (path === KEY) {
                    return Promise.resolve({ mode: 'system', url: '', bypassRules: '', systemProxy: { detected: false, url: null } });
                }
                return Promise.resolve(undefined);
            }),
        } as never;

        renderPage();
        expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toBeDefined();
        expect(screen.getByText('proxy.directConnectionWarning')).toBeDefined();
    });

    it('system 模式探测到系统代理时不显示直连警告', async () => {
        window.electron = {
            call: vi.fn((path: string) => {
                if (path === KEY) {
                    return Promise.resolve({ mode: 'system', url: '', bypassRules: '', systemProxy: { detected: true, url: 'http://127.0.0.1:10808' } });
                }
                return Promise.resolve(undefined);
            }),
        } as never;

        renderPage();
        expect(await findModeRadio('proxy.modeSystem')).toBeChecked();
        expect(screen.queryByText('proxy.directConnectionWarning')).toBeNull();
    });

    it('custom 模式地址为空时显示直连警告，填写地址后消失', async () => {
        window.electron = {
            call: vi.fn((path: string) => {
                if (path === KEY) {
                    return Promise.resolve({ mode: 'custom', url: '', bypassRules: '', systemProxy: { detected: false, url: null } });
                }
                return Promise.resolve(undefined);
            }),
        } as never;

        renderPage();
        expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toBeDefined();
        expect(screen.getByText('proxy.directConnectionWarning')).toBeDefined();
    });
});
