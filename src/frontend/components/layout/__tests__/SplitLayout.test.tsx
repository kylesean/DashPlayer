import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SplitHandle, SplitLayout, SplitPane } from '../SplitLayout';

describe('SplitLayout', () => {
    it('横向分栏保留面板内容，并把把手渲染为可聚焦的分隔条', () => {
        render(
            <SplitLayout direction="horizontal">
                <SplitPane defaultSize={75}>
                    <div>stage</div>
                </SplitPane>
                <SplitHandle data-testid="outer-handle" />
                <SplitPane defaultSize={25}>
                    <div>transcript</div>
                </SplitPane>
            </SplitLayout>,
        );

        expect(screen.getByText('stage')).toBeInTheDocument();
        expect(screen.getByText('transcript')).toBeInTheDocument();

        const group = screen.getByText('stage').closest('[data-panel-group]');
        expect(group).toHaveAttribute('data-panel-group-direction', 'horizontal');

        const handle = screen.getByTestId('outer-handle');
        expect(handle).toHaveAttribute('role', 'separator');
        expect(handle).toHaveClass('w-px');
    });

    it('纵向分栏把方向与列布局类透传到容器', () => {
        render(
            <SplitLayout direction="vertical">
                <SplitPane defaultSize={70}>
                    <div>video</div>
                </SplitPane>
                <SplitPane defaultSize={30}>
                    <div>subtitle</div>
                </SplitPane>
            </SplitLayout>,
        );

        const group = screen.getByText('video').closest('[data-panel-group]');
        expect(group).toHaveAttribute('data-panel-group-direction', 'vertical');
        expect(group).toHaveClass('flex', 'h-full', 'w-full');
    });

    it('双击把手时把事件交给调用方，用于恢复默认比例', () => {
        const onDoubleClick = vi.fn();

        render(
            <SplitLayout direction="horizontal">
                <SplitPane defaultSize={50}>
                    <div>left</div>
                </SplitPane>
                <SplitHandle data-testid="inner-handle" onDoubleClick={onDoubleClick} />
                <SplitPane defaultSize={50}>
                    <div>right</div>
                </SplitPane>
            </SplitLayout>,
        );

        fireEvent.doubleClick(screen.getByTestId('inner-handle'));
        expect(onDoubleClick).toHaveBeenCalledTimes(1);
    });
});
