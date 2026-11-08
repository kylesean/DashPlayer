import TitleBarWindows from './TitleBarWindows';
import TitleBarMac from './TitleBarMac';
import useSystem from '@/fronted/app/stores/systemStore';
import { useEffect } from 'react';

/** 桌面端自定义标题栏属性。 */
export interface TitleBarProps {
    /** 附加容器样式类。 */
    className?: string;
    /** 是否允许最大化及全屏控制。 */
    maximizable?: boolean;
}

/**
 * 按当前操作系统分发桌面端标题栏，并维护窗口失焦/聚焦状态类名。
 */
const TitleBar = ({ className = '', maximizable = true }: TitleBarProps) => {
    const isWindows = useSystem((s) => s.isWindows);
    const isMac = useSystem((s) => s.isMac);

    useEffect(() => {
        const updateFocusClass = () => {
            if (document.hasFocus()) {
                document.body.classList.add('focus');
            } else {
                document.body.classList.remove('focus');
            }
        };

        updateFocusClass();
        window.addEventListener('focus', updateFocusClass);
        window.addEventListener('blur', updateFocusClass);
        return () => {
            window.removeEventListener('focus', updateFocusClass);
            window.removeEventListener('blur', updateFocusClass);
        };
    }, []);

    return (
        <>
            {isWindows ? (
                <TitleBarWindows
                    className={className}
                    maximizable={maximizable}
                />
            ) : isMac ? (
                <TitleBarMac />
            ) : (
                <TitleBarWindows
                    className={className}
                    maximizable={maximizable}
                />
            )}
        </>
    );
};

export default TitleBar;
