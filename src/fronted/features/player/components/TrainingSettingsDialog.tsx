import { useState } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Slider } from '@astryxdesign/core/Slider';
import { Card } from '@astryxdesign/core/Card';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { Mic, Repeat, Gauge, Sliders, RotateCcw } from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { type TrainingModeConfig, useTrainingModeStore } from '@/fronted/features/player/trainingStore';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayer } from '@/fronted/features/player/playerStore';

/** 训练模式设置弹窗的入参。 */
interface TrainingSettingsDialogProps {
  /** 是否打开弹窗。 */
  open: boolean;
  /** 控制开关状态的回调。 */
  onOpenChange: (open: boolean) => void;
}

/**
 * 训练模式设置弹窗：按打开状态挂载表单，避免在副作用中同步重置草稿状态。
 */
export function TrainingSettingsDialog({ open, onOpenChange }: TrainingSettingsDialogProps) {
  return (
    <Dialog
      isOpen={open}
      onOpenChange={onOpenChange}
      purpose="form"
      width={460}
      padding={4}
    >
      {open ? <TrainingSettingsForm onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

/**
 * 训练模式设置表单内容。
 */
function TrainingSettingsForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18nTranslation('player');
  const config = useTrainingModeStore((s) => s.config);
  const updateConfig = useTrainingModeStore((s) => s.updateConfig);
  const resetConfig = useTrainingModeStore((s) => s.resetConfig);

  const sentenceLoop = usePlayer((s) => s.sentenceLoop);

  const [shadowingRatio, setShadowingRatio] = useState(config.shadowingRatio);
  const [repeatTimes, setRepeatTimes] = useState(config.repeatTimes);
  const [progressiveRatesStr, setProgressiveRatesStr] = useState(config.progressiveRates.join(', '));

  const applyConfigDraft = (nextConfig: TrainingModeConfig) => {
    setShadowingRatio(nextConfig.shadowingRatio);
    setRepeatTimes(nextConfig.repeatTimes);
    setProgressiveRatesStr(nextConfig.progressiveRates.join(', '));
  };

  /**
   * 校验并保存训练模式设置；若当前正在运行单句循环，同步热更新循环参数。
   */
  const handleSave = () => {
    // 解析递进倍速
    const parsedRates = progressiveRatesStr
      .split(/[,，\s]+/)
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !isNaN(n) && n > 0 && n <= 4);

    const safeRates = parsedRates.length > 0 ? parsedRates : [0.75, 1.0, 1.25];
    const safeRepeat = Math.max(Math.min(repeatTimes, 10), 1);
    const safeRatio = Math.max(Math.min(shadowingRatio, 5), 0.5);

    updateConfig({
      shadowingRatio: safeRatio,
      repeatTimes: safeRepeat,
      progressiveRates: safeRates,
    });

    // 如果当前正在运行重复或精听计划，则热更新
    if (sentenceLoop) {
      if (sentenceLoop.rates) {
        playerActions.setSentenceLoop({ times: safeRates.length, rates: safeRates });
      } else {
        playerActions.setSentenceLoop({ times: safeRepeat });
      }
    }

    onClose();
  };

  /**
   * 恢复训练模式默认参数并刷新当前草稿表单。
   */
  const handleReset = () => {
    resetConfig();
    applyConfigDraft(useTrainingModeStore.getState().config);
  };

  return (
    <VStack gap={4} width="100%">
      <DialogHeader
        title={t('trainingSettings.title')}
        startContent={<Sliders className="w-4 h-4 text-accent" />}
        onOpenChange={onClose}
      />

      <VStack gap={3} width="100%">
        {/* 1. 影子跟读 */}
        <Card variant="muted" padding={3}>
          <VStack gap={2} width="100%">
            <HStack vAlign="center" hAlign="between" width="100%">
              <HStack vAlign="center" gap={1.5}>
                <Mic className="w-3.5 h-3.5 text-accent" />
                <Text type="body" weight="medium">
                  {t('trainingSettings.shadowingRatio')}
                </Text>
              </HStack>
              <Text type="body" weight="semibold" className="font-mono text-accent">
                {shadowingRatio.toFixed(1)}x
              </Text>
            </HStack>
            <Text type="supporting" color="secondary">
              {t('trainingSettings.shadowingRatioHint', { ratio: shadowingRatio.toFixed(1) })}
            </Text>
            <Slider
              label={t('trainingSettings.shadowingRatio')}
              isLabelHidden
              valueDisplay="none"
              value={shadowingRatio}
              min={0.5}
              max={3.0}
              step={0.1}
              onChange={(v: number | [number, number]) => setShadowingRatio(typeof v === 'number' ? v : v[0])}
              width="100%"
            />
          </VStack>
        </Card>

        {/* 2. 每句重复遍数 */}
        <Card variant="muted" padding={3}>
          <VStack gap={2} width="100%">
            <HStack vAlign="center" hAlign="between" width="100%">
              <HStack vAlign="center" gap={1.5}>
                <Repeat className="w-3.5 h-3.5 text-amber-500" />
                <Text type="body" weight="medium">
                  {t('trainingSettings.repeatTimes')}
                </Text>
              </HStack>
              <Text type="body" weight="semibold" className="font-mono text-amber-500">
                {t('trainingSettings.repeatTimesCount', { times: repeatTimes })}
              </Text>
            </HStack>
            <Text type="supporting" color="secondary">
              {t('trainingSettings.repeatTimesHint')}
            </Text>
            <Slider
              label={t('trainingSettings.repeatTimes')}
              isLabelHidden
              valueDisplay="none"
              value={repeatTimes}
              min={1}
              max={10}
              step={1}
              onChange={(v: number | [number, number]) => setRepeatTimes(typeof v === 'number' ? v : v[0])}
              width="100%"
            />
          </VStack>
        </Card>

        {/* 3. 递进倍速精听 */}
        <Card variant="muted" padding={3}>
          <VStack gap={2} width="100%">
            <HStack vAlign="center" gap={1.5}>
              <Gauge className="w-3.5 h-3.5 text-purple-500" />
              <Text type="body" weight="medium">
                {t('trainingSettings.progressiveRates')}
              </Text>
            </HStack>
            <Text type="supporting" color="secondary">
              {t('trainingSettings.progressiveRatesHint')}
            </Text>
            <TextInput
              label={t('trainingSettings.progressiveRates')}
              isLabelHidden
              value={progressiveRatesStr}
              onChange={(val) => setProgressiveRatesStr(val)}
              placeholder={t('trainingSettings.progressiveRatesPlaceholder')}
              size="sm"
              width="100%"
            />
          </VStack>
        </Card>
      </VStack>

      <HStack vAlign="center" hAlign="between" width="100%" className="pt-2">
        <Button
          label={t('trainingSettings.reset')}
          variant="ghost"
          size="sm"
          icon={<RotateCcw className="w-3 h-3" />}
          onClick={handleReset}
        />
        <HStack vAlign="center" gap={2}>
          <Button
            label={t('trainingSettings.cancel')}
            variant="secondary"
            size="sm"
            onClick={onClose}
          />
          <Button
            label={t('trainingSettings.save')}
            variant="primary"
            size="sm"
            onClick={handleSave}
          />
        </HStack>
      </HStack>
    </VStack>
  );
}
