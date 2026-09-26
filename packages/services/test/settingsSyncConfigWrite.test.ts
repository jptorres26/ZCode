import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ISettingService } from "../src/setting/setting.js";
import { createSettingsSyncService } from "../src/settings-sync/settingsSyncService.js";

const isPosix = process.platform !== "win32";
const MCP_SELECTION = [
  {
    agent: "claudeCode" as const,
    category: "mcpServers" as const,
    sourceScope: "project" as const,
    targetScope: "project" as const,
  },
];

async function withWorkspace(body: (workspace: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "zcode-settings-sync-"));
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = join(root, "home");
  process.env.USERPROFILE = join(root, "home");
  try {
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, ".zcode"), { recursive: true });
    await writeFile(
      join(workspace, ".mcp.json"),
      JSON.stringify({ mcpServers: { imported: { command: "node", args: ["server.js"] } } }),
    );
    await body(workspace);
  } finally {
    process.env.HOME = previousHome;
    process.env.USERPROFILE = previousUserProfile;
    await rm(root, { recursive: true, force: true });
  }
}

function createService() {
  return createSettingsSyncService({ settingService: {} as ISettingService });
}

const EXISTING_CONFIG = {
  mcp: { servers: { existing: { command: "tool", env: { API_TOKEN: "placeholder-token" } } } },
};

test("MCP import keeps the target config private and preserves existing servers", async () => {
  await withWorkspace(async (workspace) => {
    const configPath = join(workspace, ".zcode", "config.json");
    await writeFile(configPath, JSON.stringify(EXISTING_CONFIG), { mode: 0o600 });

    const result = await createService().importSelected({
      workspacePath: workspace,
      selections: MCP_SELECTION,
    });

    assert.equal(result.successCount, 1);
    const written = JSON.parse(await readFile(configPath, "utf-8"));
    assert.deepEqual(Object.keys(written.mcp.servers).sort(), ["existing", "imported"]);
    if (isPosix) assert.equal((await stat(configPath)).mode & 0o777, 0o600);
  });
});

test("MCP import creates a missing config with private permissions", async () => {
  await withWorkspace(async (workspace) => {
    const configPath = join(workspace, ".zcode", "config.json");
    await createService().importSelected({ workspacePath: workspace, selections: MCP_SELECTION });
    assert.ok(JSON.parse(await readFile(configPath, "utf-8")).mcp.servers.imported);
    if (isPosix) assert.equal((await stat(configPath)).mode & 0o777, 0o600);
  });
});

test("MCP import writes through a symlinked config instead of replacing the link", async (t) => {
  if (!isPosix) {
    t.skip("symlink creation needs extra privileges on Windows");
    return;
  }
  await withWorkspace(async (workspace) => {
    const realConfig = join(workspace, "shared-config.json");
    const linkPath = join(workspace, ".zcode", "config.json");
    await writeFile(realConfig, JSON.stringify(EXISTING_CONFIG), { mode: 0o600 });
    await symlink(realConfig, linkPath);

    await createService().importSelected({ workspacePath: workspace, selections: MCP_SELECTION });

    assert.ok((await lstat(linkPath)).isSymbolicLink());
    assert.equal(await readlink(linkPath), realConfig);
    const written = JSON.parse(await readFile(realConfig, "utf-8"));
    assert.deepEqual(Object.keys(written.mcp.servers).sort(), ["existing", "imported"]);
  });
});

test("MCP import writes to a dangling symlink's target instead of replacing the link", async (t) => {
  if (!isPosix) {
    t.skip("symlink creation needs extra privileges on Windows");
    return;
  }
  await withWorkspace(async (workspace) => {
    // 刚部署的 dotfiles：链接已存在，目标文件（及其目录）尚未创建；相对目标经过一层中间链接
    const linkPath = join(workspace, ".zcode", "config.json");
    const hopPath = join(workspace, "hop.json");
    const realConfig = join(workspace, "dotfiles", "zcode", "config.json");
    await symlink("dotfiles/zcode/config.json", hopPath);
    await symlink(hopPath, linkPath);

    await createService().importSelected({ workspacePath: workspace, selections: MCP_SELECTION });

    assert.ok((await lstat(linkPath)).isSymbolicLink());
    assert.equal(await readlink(linkPath), hopPath);
    assert.ok((await lstat(hopPath)).isSymbolicLink());
    assert.ok(JSON.parse(await readFile(realConfig, "utf-8")).mcp.servers.imported);
    assert.equal((await stat(realConfig)).mode & 0o777, 0o600);
  });
});

test("a workspace config's dangling symlink may not point outside the workspace", async (t) => {
  if (!isPosix) {
    t.skip("symlink creation needs extra privileges on Windows");
    return;
  }
  await withWorkspace(async (workspace) => {
    // 克隆的仓库可能带着指向工作区外的悬空链接：不能借它把含密钥的配置写到任意位置
    const linkPath = join(workspace, ".zcode", "config.json");
    const outside = join(workspace, "..", "outside", "leak.json");
    await symlink("../../outside/leak.json", linkPath);

    const result = await createService().importSelected({
      workspacePath: workspace,
      selections: MCP_SELECTION,
    });

    assert.equal(result.successCount, 0);
    assert.equal(await readlink(linkPath), "../../outside/leak.json");
    await assert.rejects(stat(outside));
  });
});

test("a workspace config's symlink to an existing file outside the workspace is not written", async (t) => {
  if (!isPosix) {
    t.skip("symlink creation needs extra privileges on Windows");
    return;
  }
  await withWorkspace(async (workspace) => {
    // 仓库里的链接指向工作区外用户已有的 JSON 文件：不能借导入覆盖它
    const outside = join(workspace, "..", "user-settings.json");
    await writeFile(outside, JSON.stringify({ theme: "dark" }));
    const linkPath = join(workspace, ".zcode", "config.json");
    await symlink(outside, linkPath);

    const result = await createService().importSelected({
      workspacePath: workspace,
      selections: MCP_SELECTION,
    });

    assert.equal(result.successCount, 0);
    assert.equal(await readFile(outside, "utf-8"), JSON.stringify({ theme: "dark" }));
    assert.ok((await lstat(linkPath)).isSymbolicLink());
  });
});

test("MCP import fails the item on a symlink loop instead of replacing the link", async (t) => {
  if (!isPosix) {
    t.skip("symlink creation needs extra privileges on Windows");
    return;
  }
  await withWorkspace(async (workspace) => {
    const linkPath = join(workspace, ".zcode", "config.json");
    const otherPath = join(workspace, "loop.json");
    await symlink(otherPath, linkPath);
    await symlink(linkPath, otherPath);

    const result = await createService().importSelected({
      workspacePath: workspace,
      selections: MCP_SELECTION,
    });

    assert.equal(result.successCount, 0);
    assert.equal(await readlink(linkPath), otherPath);
  });
});

test("an unreadable target config fails the item without aborting scan or import", async () => {
  await withWorkspace(async (workspace) => {
    const configPath = join(workspace, ".zcode", "config.json");
    await writeFile(configPath, "{ not json");
    const service = createService();

    const discovery = await service.detect({
      workspacePath: workspace,
      intent: "manualImport",
      categories: ["mcpServers"],
    });
    assert.ok(Array.isArray(discovery.agents));

    const result = await service.importSelected({
      workspacePath: workspace,
      selections: MCP_SELECTION,
    });
    assert.equal(result.successCount, 0);
    assert.equal(result.failedCount, 1);
    assert.equal(await readFile(configPath, "utf-8"), "{ not json");
  });
});
