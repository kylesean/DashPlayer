import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import React from 'react';
import ProxySetting from '@/fronted/features/settings/ProxySetting';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KEY = 'settings/proxy/detail';

beforeAll(() => {
    if (typeof window !== 'undefined') {
        HTMLElement.prototype.hasPointerCapture = () => false;
        HTMLElement.prototype.setPointerCapture = () => {};
        HTMLElement.prototype.releasePointerCapture = () => {};
        HTMLElement.prototype.scrollIntoView = () => {};
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
        await sleep(200);
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
        await sleep(200);
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
        await findModeRadio('proxy.modeSystem');
        await sleep(200);
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
