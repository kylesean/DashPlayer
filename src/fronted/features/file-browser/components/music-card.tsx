import { cn } from '@/fronted/lib/utils';
import { Music } from 'lucide-react';
import React from 'react';
import { MUSIC_CARD_GRADIENTS } from '@/fronted/styles/decorationPalette';

const gradientCombinations = MUSIC_CARD_GRADIENTS;

interface MusicCardProps {
    fileName: string;
}

const MusicCard: React.FC<MusicCardProps> = ({ fileName }) => {
    // 使用文件名生成一个简单的哈希值
    const hashCode = (str: string) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    };

    // 基于文件名选择一个渐变色组合
    const colorIndex = hashCode(fileName) % gradientCombinations.length;
    const [from, via, to] = gradientCombinations[colorIndex];

    return (
        <div
            style={{
                aspectRatio: '16/9',
                background: `radial-gradient(ellipse at bottom, ${from}, ${via}, ${to})`
            }}
            className={cn(
                'w-full relative flex items-center justify-center',
                'transition-all duration-300',
            )}
        >
            <div className="absolute inset-0 bg-gradient-to-t from-background/30 to-transparent" />
            <Music className="w-12 h-12 text-media-fg drop-shadow-lg z-10" />
        </div>
    );
};

export default MusicCard;
