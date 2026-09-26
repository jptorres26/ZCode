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
