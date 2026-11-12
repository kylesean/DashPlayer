import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { cn } from '@/fronted/lib/utils';

type Props = {
  /** 触发器提示文案，同时作为确认弹窗标题。 */
  title: string;
  /** 确认按钮文案。 */
  confirmLabel: string;
  /** 删除请求是否进行中。 */
  deleting: boolean;
  /** 确认后触发；返回 false 表示删除失败，确认弹窗会保持打开。 */
  onConfirm: () => void | Promise<boolean | void>;
  /** 常态触发器的自定义样式；用于适配列表行、图片覆盖层等不同宿主。 */
  triggerClassName?: string;
  /** 确认弹窗的后果说明；缺省使用通用不可撤销提示。 */
  description?: string;
};

/**
 * 删除按钮：点击后由 AlertDialog 统一确认，不再使用原地二次点击。
 *
 * 行为说明：
 * - 与设置页、观看记录删除共用同一套 AlertDialog 交互；
 * - 删除进行中显示转圈并禁止重复提交。
 */
export default function ConfirmDeleteButton({
  title,
  confirmLabel,
  deleting,
  onConfirm,
  triggerClassName,
  description,
}: Props) {
  const { t } = useI18nTranslation('common');
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isLoading = deleting || isSubmitting;

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (!isLoading) {
            setOpen(true);
          }
        }}
        disabled={isLoading}
        className={cn(
          'p-1 rounded-md transition-all cursor-pointer shrink-0',
          'text-secondary hover:text-error hover:bg-error/10',
          isLoading && 'opacity-60 cursor-not-allowed',
          triggerClassName
        )}
        title={title}
      >
        {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
      </button>
      <AlertDialog
        isOpen={open}
        onOpenChange={setOpen}
        title={title}
        description={description ?? t('deleteIrreversibleHint')}
        actionLabel={confirmLabel}
        cancelLabel={t('cancel')}
        actionVariant="destructive"
        isActionLoading={isLoading}
        onAction={async () => {
          if (isLoading) return;
          setIsSubmitting(true);
          try {
            const succeeded = await onConfirm();
            if (succeeded !== false) {
              setOpen(false);
            }
          } catch {
            // 失败时保持弹窗打开；具体提示由调用方负责。
          } finally {
            setIsSubmitting(false);
          }
        }}
      />
    </>
  );
}
