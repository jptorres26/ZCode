import { Columns2Icon, Rows2Icon, SlidersHorizontalIcon, WrapTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { normalizeReviewDiffStyle, type ReviewDiffStyle } from "@/lib/codePreviewSettings.js";

/** Review 面板头部的 diff 视图选项菜单。规范：docs/specs/git-review-pane-diff-view-options.md */
export function GitPaneDiffViewMenu({
  diffStyle,
  canSplit,
  wrapLongLines,
  onDiffStyleChange,
  onWrapLongLinesChange,
}: {
  /** 当前实际渲染的布局（窄面板时恒为 unified）。 */
  diffStyle: ReviewDiffStyle;
  canSplit: boolean;
  wrapLongLines: boolean;
  onDiffStyleChange: (diffStyle: ReviewDiffStyle) => void;
  onWrapLongLinesChange: (wrapLongLines: boolean) => void;
}) {
  const { intl } = useZCodeIntl();
  const triggerLabel = intl.formatMessage({ id: "git.viewOptions.trigger" });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label={triggerLabel}
          title={triggerLabel}
          data-git-diff-view-options
        >
          <SlidersHorizontalIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          {intl.formatMessage({ id: "git.viewOptions.layout" })}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={diffStyle}
          onValueChange={(value) => onDiffStyleChange(normalizeReviewDiffStyle(value))}
        >
          <DropdownMenuRadioItem value="unified">
            <Rows2Icon className="size-4" />
            {intl.formatMessage({ id: "git.viewOptions.unified" })}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="split" disabled={!canSplit}>
            <Columns2Icon className="size-4" />
            {intl.formatMessage({ id: "git.viewOptions.split" })}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {canSplit ? null : (
          <p className="px-2 pb-1.5 text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "git.viewOptions.splitUnavailable" })}
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={wrapLongLines}
          onCheckedChange={(checked) => onWrapLongLinesChange(Boolean(checked))}
        >
          <WrapTextIcon className="size-4" />
          {intl.formatMessage({ id: "git.viewOptions.wrapLines" })}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
