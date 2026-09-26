import { parseProjectActionsConfig, type ProjectActionsConfig } from "@zcode/shared";
import { PlayIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useIsOfficeMode } from "@/hooks/useInterfaceMode.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getErrorMessage } from "@/lib/errorMessage.js";
import { isMissingFileError } from "@/lib/missingFileError.js";
import { joinFilePath } from "@/lib/path.js";
import { logger } from "@/logger.js";
import { WINDOWS_CAPTION_CONTROL_CLASS } from "@/windowCaptionControls.js";

/** 与文件服务单次读取上限一致；配置更大时明确提示，而不是截断后报 JSON 无效。 */
const PROJECT_ACTIONS_READ_BYTES = 256 * 1024;

type ActionsState =
  | { status: "loading" }
  | { status: "ready"; config: ProjectActionsConfig }
  | { status: "unreadable" };

/**
 * 标题栏“运行操作”菜单：每次打开时读取 `<workspace>/.zcode/config.json` 的 actions，点击才运行。
 * 规范：docs/specs/project-actions.md
 */
export function WorkspaceProjectActionsMenu({
  workspaceAbsPath,
  workspaceIdentity,
  remoteSessionId,
  remoteTarget,
  disabledReason,
  onRunAction,
  useWindowsCaptionSpacing = false,
}: {
  workspaceAbsPath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: unknown;
  disabledReason?: string;
  onRunAction: (action: { name: string; command: string }) => void;
  useWindowsCaptionSpacing?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const isOfficeMode = useIsOfficeMode();
  const { fileService } = useWorkspaceServices(
    workspaceAbsPath,
    remoteSessionId,
    workspaceIdentity,
    remoteTarget,
  );
  const [state, setState] = useState<ActionsState>({ status: "loading" });
  const requestIdRef = useRef(0);
  const label = intl.formatMessage({ id: "projectActions.trigger" });

  const loadActions = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState({ status: "loading" });
    const configPath = joinFilePath(joinFilePath(workspaceAbsPath, ".zcode"), "config.json");
    let next: ActionsState;
    try {
      // 直接读取而不走 checkFilesExist：后者为聊天路径提及做了一分钟正负结果缓存，
      // 用户刚创建或删除配置时会读到过期结论。文件不存在视为没有操作。
      const slice = await fileService
        .readTextFile({ path: configPath, length: PROJECT_ACTIONS_READ_BYTES })
        .catch((error: unknown) => {
          if (isMissingFileError(error)) return null;
          throw error;
        });
      // 修复原因：默认只读 128KB 且忽略 truncated，合规但较大的配置会被截断后误报为无效 JSON。
      next = slice?.truncated
        ? { status: "ready", config: { actions: [], error: "too-large" } }
        : { status: "ready", config: parseProjectActionsConfig(slice ? slice.content : null) };
    } catch (error) {
      logger.warn("[ProjectActions] 读取 .zcode/config.json 失败", {
        error: getErrorMessage(error),
      });
      next = { status: "unreadable" };
    }
    // 连续快速打开时只采用最后一次读取的结果。
    if (requestId === requestIdRef.current) {
      setState(next);
    }
  }, [fileService, workspaceAbsPath]);

  if (isOfficeMode) return null;

  const hint = (id: string) => (
    <p className="px-2 py-1.5 text-ui-sm text-foreground-subtle">{intl.formatMessage({ id })}</p>
  );
  const actions = state.status === "ready" ? state.config.actions : [];

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) void loadActions();
      }}
    >
      <ControlHintTooltip title={disabledReason ?? label} side="bottom">
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-md"
            className={cn(
              "text-foreground hover:bg-hover hover:text-foreground [app-region:no-drag]",
              useWindowsCaptionSpacing && WINDOWS_CAPTION_CONTROL_CLASS,
            )}
            aria-label={label}
            disabled={Boolean(disabledReason)}
            data-project-actions-trigger
          >
            <PlayIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </ControlHintTooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{intl.formatMessage({ id: "projectActions.title" })}</DropdownMenuLabel>
        {state.status === "loading" ? hint("projectActions.loading") : null}
        {state.status === "ready" && state.config.error === "too-large"
          ? hint("projectActions.tooLarge")
          : null}
        {state.status === "unreadable" ||
        (state.status === "ready" &&
          state.config.error !== undefined &&
          state.config.error !== "too-large")
          ? hint("projectActions.invalid")
          : null}
        {state.status === "ready" && !state.config.error && actions.length === 0
          ? hint("projectActions.empty")
          : null}
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.id}
            className="flex-col items-start gap-0.5"
            onSelect={() => onRunAction({ name: action.name, command: action.command })}
          >
            <span className="text-ui-base text-foreground">{action.name}</span>
            {/* 修复原因：截断显示会让仓库配置把后续命令藏在长空白之后；完整展示即将执行的命令（菜单整体可滚动）。 */}
            <span className="w-full font-mono text-ui-sm break-all whitespace-pre-wrap text-foreground-subtle">
              {action.command}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
