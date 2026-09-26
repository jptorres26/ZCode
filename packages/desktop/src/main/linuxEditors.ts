/**
 * Linux 上“在…中打开”的目标检测：编辑器、终端与文件管理器。
 * 规范：docs/specs/open-in-editor-linux.md
 *
 * 之前 getEditorDefsForCurrentPlatform() 在 Linux 返回空数组，Linux 桌面没有任何打开入口。
 * 这里只依赖 node:fs / node:path，不引入 electron，便于在 node:test 中直接验证。
 */
import { constants } from "node:fs";
import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, extname, isAbsolute, join } from "node:path";
import type { EditorInfo } from "@zcode/shared";

export type LinuxEditorKind = "editor" | "terminal" | "file-manager";

interface LinuxEditorCandidate {
  id: string;
  name: string;
  kind: LinuxEditorKind;
  commands: readonly string[];
}

export interface LinuxEditorDef {
  id: string;
  name: string;
  kind: LinuxEditorKind;
  /** 命中的可执行文件绝对路径。 */
  commandPath: string;
  /** 解析符号链接后的程序名（如 x-terminal-emulator → gnome-terminal），用于终端参数与图标匹配。 */
  programName: string;
}

export interface LinuxEditorFs {
  isExecutableFile(path: string): Promise<boolean>;
  realpath(path: string): Promise<string>;
  listDir(path: string): Promise<string[]>;
  readText(path: string): Promise<string | null>;
  readBinary(path: string): Promise<Buffer | null>;
}

const JETBRAINS = (id: string, name: string, commands: string[]): LinuxEditorCandidate => ({
  id,
  name,
  kind: "editor",
  commands,
});

const LINUX_EDITOR_CANDIDATES: readonly LinuxEditorCandidate[] = [
  { id: "vscode", name: "VS Code", kind: "editor", commands: ["code"] },
  { id: "vscode-insiders", name: "VS Code Insiders", kind: "editor", commands: ["code-insiders"] },
  { id: "vscodium", name: "VSCodium", kind: "editor", commands: ["codium"] },
  { id: "cursor", name: "Cursor", kind: "editor", commands: ["cursor"] },
  { id: "zed", name: "Zed", kind: "editor", commands: ["zed", "zeditor"] },
  { id: "sublime", name: "Sublime Text", kind: "editor", commands: ["subl"] },
  JETBRAINS("idea", "IntelliJ IDEA", ["idea", "intellij-idea-ultimate", "intellij-idea-community"]),
  JETBRAINS("webstorm", "WebStorm", ["webstorm"]),
  JETBRAINS("pycharm", "PyCharm", ["pycharm", "pycharm-professional", "pycharm-community"]),
  JETBRAINS("goland", "GoLand", ["goland"]),
  JETBRAINS("clion", "CLion", ["clion"]),
  JETBRAINS("rider", "Rider", ["rider"]),
  JETBRAINS("phpstorm", "PhpStorm", ["phpstorm"]),
  JETBRAINS("rubymine", "RubyMine", ["rubymine"]),
  JETBRAINS("datagrip", "DataGrip", ["datagrip"]),
  {
    id: "terminal",
    name: "Terminal",
    kind: "terminal",
    commands: [
      "x-terminal-emulator",
      "gnome-terminal",
      "konsole",
      "xfce4-terminal",
      "kitty",
      "alacritty",
      "wezterm",
      "ghostty",
    ],
  },
  { id: "file-manager", name: "Files", kind: "file-manager", commands: ["xdg-open"] },
];

const ICON_SIZES = ["256x256", "128x128", "96x96", "64x64", "48x48", "32x32"] as const;

function svgDataUrl(body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7c7c85" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** 找不到应用图标时的中性图标，灰色描边在浅色与深色主题下都可辨认。 */
const FALLBACK_ICONS: Record<LinuxEditorKind, string> = {
  editor: svgDataUrl('<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'),
  terminal: svgDataUrl('<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>'),
  "file-manager": svgDataUrl(
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  ),
};

function uniqueNonEmpty(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
}

export function getLinuxExecutableSearchDirs(env: NodeJS.ProcessEnv, home: string): string[] {
  return uniqueNonEmpty([
    ...(env.PATH ?? "").split(delimiter),
    join(home, ".local", "share", "JetBrains", "Toolbox", "scripts"),
    "/snap/bin",
  ]);
}

export function getLinuxXdgDataDirs(env: NodeJS.ProcessEnv, home: string): string[] {
  return uniqueNonEmpty([
    env.XDG_DATA_HOME?.trim() || join(home, ".local", "share"),
    ...(env.XDG_DATA_DIRS?.trim() || "/usr/local/share:/usr/share").split(delimiter),
    join(home, ".local", "share", "flatpak", "exports", "share"),
    "/var/lib/flatpak/exports/share",
    "/var/lib/snapd/desktop",
  ]);
}

/** 去掉 Debian 等发行版给 alternatives 目标加的 `.wrapper` / `.real` 后缀。 */
function normalizeProgramName(path: string): string {
  return basename(path).replace(/\.(wrapper|real)$/, "");
}

export async function detectLinuxEditors(options: {
  searchDirs: readonly string[];
  fs: LinuxEditorFs;
}): Promise<LinuxEditorDef[]> {
  const found: LinuxEditorDef[] = [];
  for (const candidate of LINUX_EDITOR_CANDIDATES) {
    const commandPath = await findFirstExecutable(candidate.commands, options);
    if (!commandPath) continue;
    const resolved = await options.fs.realpath(commandPath).catch(() => commandPath);
    found.push({
      id: candidate.id,
      name: candidate.name,
      kind: candidate.kind,
      commandPath,
      programName: normalizeProgramName(resolved),
    });
  }
  return found;
}

async function findFirstExecutable(
  commands: readonly string[],
  options: { searchDirs: readonly string[]; fs: LinuxEditorFs },
): Promise<string | null> {
  for (const command of commands) {
    for (const dir of options.searchDirs) {
      const candidate = join(dir, command);
      if (await options.fs.isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

/** 只读取 `[Desktop Entry]` 分组中的 Exec / Icon / NoDisplay。 */
export function parseDesktopEntry(content: string): { exec?: string; icon?: string } {
  const result: { exec?: string; icon?: string } = {};
  let inEntry = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      inEntry = line === "[Desktop Entry]";
      continue;
    }
    if (!inEntry) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === "Exec" && result.exec === undefined) result.exec = value;
    if (key === "Icon" && result.icon === undefined) result.icon = value;
  }
  return result;
}

/** Exec 行中真正启动的程序名：跳过 `env` 与 `NAME=value`，去掉引号，取 basename。 */
export function desktopExecProgramName(exec: string): string | null {
  const tokens = exec.match(/"[^"]*"|\S+/g) ?? [];
  for (const rawToken of tokens) {
    const token = rawToken.replace(/^"|"$/g, "");
    if (token === "env" || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    return normalizeProgramName(token);
  }
  return null;
}

export function getLinuxIconFileCandidates(
  iconName: string,
  dataDirs: readonly string[],
): string[] {
  if (isAbsolute(iconName)) return [iconName];
  const candidates: string[] = [];
  for (const dataDir of dataDirs) {
    for (const size of ICON_SIZES) {
      candidates.push(join(dataDir, "icons", "hicolor", size, "apps", `${iconName}.png`));
    }
    candidates.push(join(dataDir, "icons", "hicolor", "scalable", "apps", `${iconName}.svg`));
    candidates.push(
      join(dataDir, "pixmaps", `${iconName}.png`),
      join(dataDir, "pixmaps", `${iconName}.svg`),
    );
  }
  return candidates;
}

/** 按 XDG 优先级建立“程序名 → Icon”索引，同名程序以先出现的条目为准。 */
export async function buildDesktopIconIndex(
  dataDirs: readonly string[],
  fs: LinuxEditorFs,
): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  for (const dataDir of dataDirs) {
    const applicationsDir = join(dataDir, "applications");
    const entries = await fs.listDir(applicationsDir).catch(() => []);
    for (const entry of entries.filter((name) => name.endsWith(".desktop")).sort()) {
      const content = await fs.readText(join(applicationsDir, entry));
      if (!content) continue;
      const { exec, icon } = parseDesktopEntry(content);
      const programName = exec ? desktopExecProgramName(exec) : null;
      if (programName && icon && !index.has(programName)) index.set(programName, icon);
    }
  }
  return index;
}

export async function resolveLinuxEditorIconDataUrl(
  def: LinuxEditorDef,
  options: { dataDirs: readonly string[]; iconIndex: Map<string, string>; fs: LinuxEditorFs },
): Promise<string> {
  const iconName =
    options.iconIndex.get(basename(def.commandPath)) ?? options.iconIndex.get(def.programName);
  if (iconName) {
    for (const candidate of getLinuxIconFileCandidates(iconName, options.dataDirs)) {
      const extension = extname(candidate).toLowerCase();
      if (extension !== ".png" && extension !== ".svg") continue;
      const content = await options.fs.readBinary(candidate);
      if (!content || content.length === 0) continue;
      const mime = extension === ".png" ? "image/png" : "image/svg+xml";
      return `data:${mime};base64,${content.toString("base64")}`;
    }
  }
  return FALLBACK_ICONS[def.kind];
}

export function createNodeLinuxEditorFs(): LinuxEditorFs {
  return {
    async isExecutableFile(path) {
      try {
        if (!(await stat(path)).isFile()) return false;
        await access(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    realpath: (path) => realpath(path),
    listDir: (path) => readdir(path),
    readText: (path) => readFile(path, "utf8").catch(() => null),
    readBinary: (path) => readFile(path).catch(() => null),
  };
}

let linuxEditorDefsPromise: Promise<LinuxEditorDef[]> | null = null;

/** 进程生命周期内缓存检测结果（与 macOS / Windows 的 cachedEditors 语义一致）。 */
export function getLinuxEditorDefs(): Promise<LinuxEditorDef[]> {
  linuxEditorDefsPromise ??= detectLinuxEditors({
    searchDirs: getLinuxExecutableSearchDirs(process.env, homedir()),
    fs: createNodeLinuxEditorFs(),
  });
  return linuxEditorDefsPromise;
}

export async function getInstalledLinuxEditors(): Promise<EditorInfo[]> {
  const fs = createNodeLinuxEditorFs();
  const dataDirs = getLinuxXdgDataDirs(process.env, homedir());
  const [defs, iconIndex] = await Promise.all([
    getLinuxEditorDefs(),
    buildDesktopIconIndex(dataDirs, fs),
  ]);
  return await Promise.all(
    defs.map(async (def) => ({
      id: def.id,
      name: def.name,
      iconDataUrl: await resolveLinuxEditorIconDataUrl(def, { dataDirs, iconIndex, fs }),
    })),
  );
}
