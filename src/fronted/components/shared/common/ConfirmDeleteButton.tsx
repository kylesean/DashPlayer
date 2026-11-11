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
  /** 确认后触发。 */
  onConfirm: () => void;
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

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (!deleting) {
            setOpen(true);
          }
        }}
        disabled={deleting}
        className={cn(
          'p-1 rounded-md transition-all cursor-pointer shrink-0',
          'text-muted-foreground hover:text-destructive hover:bg-destructive/10',
          deleting && 'opacity-60 cursor-not-allowed',
          triggerClassName
        )}
        title={title}
      >
        {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
      </button>
      <AlertDialog
        isOpen={open}
        onOpenChange={setOpen}
        title={title}
        description={description ?? t('deleteIrreversibleHint', { defaultValue: '此操作无法撤销，确定继续吗？' })}
        actionLabel={confirmLabel}
        cancelLabel={t('cancel', { defaultValue: '取消' })}
        actionVariant="destructive"
        isActionLoading={deleting}
        onAction={() => {
          setOpen(false);
          onConfirm();
        }}
      />
    </>
  );
}
