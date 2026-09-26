import type { Event } from "@zcode/rpc";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type { TerminalFontFamilySource, TerminalThemeProfile } from "./terminalProfile.js";

export interface TerminalWindowsPtyInfo {
  backend: "conpty" | "winpty";
  buildNumber?: number;
}

export interface ITerminalService {
  create(params: { cols: number; rows: number; cwd?: string }): Promise<{
    id: string;
    shell: string;
    fontFamily: string;
    fontSize?: number;
    theme?: TerminalThemeProfile;
    fontFamilySource: TerminalFontFamilySource;
    windowsPty?: TerminalWindowsPtyInfo;
  }>;
  write(params: { id: string; data: string }): Promise<void>;
  resize(params: { id: string; cols: number; rows: number }): Promise<void>;
  dispose(params: { id: string }): Promise<void>;
  /**
   * 结束所有初始 cwd 位于 `path`（含其自身）下的终端，并在它们退出后 resolve；此后在该目录下新建终端会被拒绝，
   * 直到调用 releasePathBlock。删除目录（如 worktree）前调用：Windows 上以该目录为 cwd 的进程会占用目录。
   * 规范：docs/specs/git-worktree-task.md
   */
  disposeUnderPath(params: { path: string }): Promise<void>;
  /** 解除 disposeUnderPath 建立的新建封锁（删除完成或放弃后调用）。 */
  releasePathBlock(params: { path: string }): Promise<void>;
  onDynamicData(id: string): Event<string>;
  onDynamicExit(id: string): Event<number>;
}

export const ITerminalService = createServiceDescriptor<ITerminalService>(ServiceChannels.Terminal);
