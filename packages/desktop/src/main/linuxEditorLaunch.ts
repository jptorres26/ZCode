/**
 * Linux 上启动编辑器 / 终端。规范：docs/specs/open-in-editor-linux.md
 *
 * GUI 程序（尤其是 gedit、终端）可能一直运行到窗口关闭；这里 detached 启动并 unref，
 * 在 `spawn` 事件时即视为成功，避免 openInEditor 的 Promise 挂到用户关闭窗口为止。
 */
import { spawn } from "node:child_process";
import type { LinuxEditorDef } from "./linuxEditors.js";

/** 各终端设置启动目录的参数；未知终端只依赖进程 cwd。 */
export function getLinuxTerminalArgs(programName: string, directory: string): string[] {
  switch (programName) {
    case "gnome-terminal":
    case "xfce4-terminal":
    case "ghostty":
      return [`--working-directory=${directory}`];
    case "konsole":
      return ["--workdir", directory];
    case "kitty":
      return ["--directory", directory];
    case "alacritty":
      return ["--working-directory", directory];
    case "wezterm":
      return ["start", "--cwd", directory];
    default:
      return [];
  }
}

export function launchDetached(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function launchLinuxEditor(
  def: LinuxEditorDef,
  path: string,
  directory: string,
): Promise<void> {
  if (def.kind === "terminal") {
    await launchDetached(
      def.commandPath,
      getLinuxTerminalArgs(def.programName, directory),
      directory,
    );
    return;
  }
  await launchDetached(def.commandPath, [path]);
}
