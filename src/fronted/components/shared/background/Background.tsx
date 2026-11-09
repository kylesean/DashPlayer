import React from 'react';
import { cn } from '@/fronted/lib/utils';

/**
 * 基础背景组件，使用 Astryx 语义背景 token。
 */
const Background = () => {
    return <div className={cn('w-full h-full bg-body')} />;
};

Background.defaultProps = {
    className: '',
};

export default Background;
