import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useAppShortcut, useAppShortcutDisplay } from '@/hooks/useAppShortcut';

import { MENU_ITEM_CLASS } from './menuStyles';

interface ShowInExplorerMenuItemProps {
  enabled: boolean;
  label: string;
  onSelect: () => void | Promise<void>;
}

/**
 * 本地项目菜单共用的“在文件管理器中打开”。该组件只会随已打开的
 * DropdownMenuContent 挂载，因此快捷键天然只归属于当前菜单。
 */
export function ShowInExplorerMenuItem({ enabled, label, onSelect }: ShowInExplorerMenuItemProps) {
  const shortcut = useAppShortcutDisplay('show-in-explorer');

  useAppShortcut(
    'show-in-explorer',
    () => {
      void onSelect();
      return true;
    },
    { enabled },
  );

  return (
    <DropdownMenuItem onSelect={() => void onSelect()} className={MENU_ITEM_CLASS}>
      <span className="flex-1">{label}</span>
      {shortcut && (
        <kbd className="ml-auto shrink-0 text-[10px] text-[var(--cmd-palette-item-meta)]">
          {shortcut}
        </kbd>
      )}
    </DropdownMenuItem>
  );
}
