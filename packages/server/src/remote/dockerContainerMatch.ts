import type { DockerContainerInfo } from "@zcode/shared";

type DockerContainerMatchResult =
  | { status: "matched"; container: DockerContainerInfo }
  | { status: "not-found" }
  | { status: "ambiguous"; candidates: DockerContainerInfo[] };

const HEX_ID_PATTERN = /^[0-9a-f]+$/i;

/**
 * 按用户填写的名称或 ID 找到 Docker 容器（纯函数）。
 *
 * 修复原因：`docker ps --format {{json .}}` 返回 12 位短 ID，用户粘贴 64 位完整 ID 时既不等于也不是
 * 短 ID 的前缀，永远匹配不到；多个容器共享同一 ID 前缀时静默选中 ps 顺序里的第一个；空目标会前缀匹配
 * 到任意容器。
 * 修复依据：精确名称 > ID 相等 > 唯一的 ID 前缀；前缀命中多个时报歧义，空目标视为未找到。
 * 修复原因（续）：曾用“目标以 12 位短 ID 开头”接受完整 ID，其余 52 位从未校验，输错或过期的完整 ID 会静默连到
 * 当前容器。修复依据：调用方传入 `docker ps --no-trunc` 的完整 ID，目标必须与完整 ID 相等或是其唯一前缀。
 */
export function matchDockerContainer(
  containers: readonly DockerContainerInfo[],
  rawTarget: string,
): DockerContainerMatchResult {
  const target = rawTarget.trim();
  if (target.length === 0) {
    return { status: "not-found" };
  }

  const byName = containers.find((container) => container.name === target);
  if (byName) {
    return { status: "matched", container: byName };
  }
  if (!HEX_ID_PATTERN.test(target)) {
    return { status: "not-found" };
  }

  const lowerTarget = target.toLowerCase();
  const byId = containers.find((container) => container.id.toLowerCase() === lowerTarget);
  if (byId) {
    return { status: "matched", container: byId };
  }

  const byPrefix = containers.filter((container) =>
    container.id.toLowerCase().startsWith(lowerTarget),
  );
  if (byPrefix.length === 1) {
    return { status: "matched", container: byPrefix[0]! };
  }
  return byPrefix.length > 1
    ? { status: "ambiguous", candidates: byPrefix }
    : { status: "not-found" };
}
