import assert from "node:assert/strict";
import test from "node:test";
import { getLinuxTerminalArgs, launchDetached } from "../src/main/linuxEditorLaunch.js";
import {
  buildDesktopIconIndex,
  desktopExecProgramName,
  detectLinuxEditors,
  getLinuxExecutableSearchDirs,
  getLinuxIconFileCandidates,
  getLinuxXdgDataDirs,
  parseDesktopEntry,
  resolveLinuxEditorIconDataUrl,
  type LinuxEditorFs,
} from "../src/main/linuxEditors.js";

function createFakeFs(options: {
  executables?: string[];
  files?: Record<string, string>;
  symlinks?: Record<string, string>;
}): LinuxEditorFs {
  const executables = new Set(options.executables ?? []);
  const files = options.files ?? {};
  return {
    isExecutableFile: async (path) => executables.has(path),
    realpath: async (path) => options.symlinks?.[path] ?? path,
    listDir: async (dir) => {
      const prefix = `${dir}/`;
      const names = Object.keys(files)
        .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .map((path) => path.slice(prefix.length));
      if (names.length === 0) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return names;
    },
    readText: async (path) => files[path] ?? null,
    readBinary: async (path) => (path in files ? Buffer.from(files[path]!) : null),
  };
}

test("search dirs include PATH, JetBrains Toolbox scripts and snap", () => {
  assert.deepEqual(getLinuxExecutableSearchDirs({ PATH: "/usr/bin::/bin:/usr/bin" }, "/home/u"), [
    "/usr/bin",
    "/bin",
    "/home/u/.local/share/JetBrains/Toolbox/scripts",
    "/snap/bin",
  ]);
  assert.deepEqual(getLinuxXdgDataDirs({}, "/home/u").slice(0, 3), [
    "/home/u/.local/share",
    "/usr/local/share",
    "/usr/share",
  ]);
});

test("detection keeps candidate order, one entry per target, and resolves terminal alternatives", async () => {
  const fs = createFakeFs({
    executables: [
      "/usr/bin/code",
      "/usr/bin/zeditor",
      "/snap/bin/pycharm-community",
      "/usr/bin/x-terminal-emulator",
      "/usr/bin/konsole",
      "/usr/bin/xdg-open",
    ],
    symlinks: { "/usr/bin/x-terminal-emulator": "/usr/bin/gnome-terminal.wrapper" },
  });
  const defs = await detectLinuxEditors({ searchDirs: ["/usr/bin", "/snap/bin"], fs });
  assert.deepEqual(
    defs.map((def) => [def.id, def.commandPath, def.programName]),
    [
      ["vscode", "/usr/bin/code", "code"],
      ["zed", "/usr/bin/zeditor", "zeditor"],
      ["pycharm", "/snap/bin/pycharm-community", "pycharm-community"],
      ["terminal", "/usr/bin/x-terminal-emulator", "gnome-terminal"],
      ["file-manager", "/usr/bin/xdg-open", "xdg-open"],
    ],
  );
});

test("files that are not executable are ignored", async () => {
  const defs = await detectLinuxEditors({
    searchDirs: ["/usr/bin"],
    fs: createFakeFs({ executables: [] }),
  });
  assert.deepEqual(defs, []);
});

test("desktop entries map program names to icons", async () => {
  assert.deepEqual(
    parseDesktopEntry(
      "[Desktop Entry]\nName=Code\nExec=/usr/share/code/code --unity-launch %F\nIcon=vscode\n[Desktop Action new]\nExec=other\nIcon=x\n",
    ),
    { exec: "/usr/share/code/code --unity-launch %F", icon: "vscode" },
  );
  assert.equal(desktopExecProgramName('env FOO=1 "/opt/Zed Editor/zed" %U'), "zed");
  assert.equal(desktopExecProgramName("gnome-terminal.real --window"), "gnome-terminal");

  const fs = createFakeFs({
    files: {
      "/usr/share/applications/code.desktop": "[Desktop Entry]\nExec=code %F\nIcon=vscode\n",
      "/usr/share/applications/org.gnome.Terminal.desktop":
        "[Desktop Entry]\nExec=gnome-terminal --window\nIcon=org.gnome.Terminal\n",
      "/usr/share/icons/hicolor/128x128/apps/vscode.png": "png-bytes",
    },
  });
  const index = await buildDesktopIconIndex(["/home/u/.local/share", "/usr/share"], fs);
  assert.equal(index.get("code"), "vscode");
  assert.equal(index.get("gnome-terminal"), "org.gnome.Terminal");

  const iconUrl = await resolveLinuxEditorIconDataUrl(
    { id: "vscode", name: "VS Code", kind: "editor", commandPath: "/usr/bin/code", programName: "code" },
    { dataDirs: ["/usr/share"], iconIndex: index, fs },
  );
  assert.equal(iconUrl, `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`);
});

test("missing icons fall back to a neutral built-in svg", async () => {
  const iconUrl = await resolveLinuxEditorIconDataUrl(
    {
      id: "file-manager",
      name: "Files",
      kind: "file-manager",
      commandPath: "/usr/bin/xdg-open",
      programName: "xdg-open",
    },
    { dataDirs: ["/usr/share"], iconIndex: new Map(), fs: createFakeFs({}) },
  );
  assert.match(iconUrl, /^data:image\/svg\+xml;base64,/);
  assert.deepEqual(getLinuxIconFileCandidates("/opt/app/icon.png", ["/usr/share"]), [
    "/opt/app/icon.png",
  ]);
});

test("terminal launch arguments set the working directory", () => {
  assert.deepEqual(getLinuxTerminalArgs("gnome-terminal", "/w s"), ["--working-directory=/w s"]);
  assert.deepEqual(getLinuxTerminalArgs("konsole", "/w"), ["--workdir", "/w"]);
  assert.deepEqual(getLinuxTerminalArgs("wezterm", "/w"), ["start", "--cwd", "/w"]);
  assert.deepEqual(getLinuxTerminalArgs("x-terminal-emulator", "/w"), []);
});

test("detached launch resolves on spawn and rejects for missing programs", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX-only launcher");
    return;
  }
  await launchDetached(process.execPath, ["-e", "setTimeout(() => {}, 50)"]);
  await assert.rejects(launchDetached("/nonexistent/zcode-editor", []), /ENOENT/);
});
