const ENV_LONG_OPTIONS: Readonly<Record<string, "none" | "optional" | "required" | "split">> = {
  "--argv0": "required",
  "--block-signal": "optional",
  "--chdir": "required",
  "--debug": "none",
  "--default-signal": "optional",
  "--help": "none",
  "--ignore-environment": "none",
  "--ignore-signal": "optional",
  "--list-signal-handling": "none",
  "--null": "none",
  "--split-string": "split",
  "--unset": "required",
  "--version": "none",
};
const ENV_SHORT_FLAGS = new Set(["i", "0", "v"]);
const ENV_SHORT_VALUE_OPTIONS = new Set(["u", "C", "a"]);

/**
 * 解析 env 的一个选项，返回消耗的 token 数；0 表示选项结束、当前 token 是命令；
 * undefined 表示无法生成稳定前缀（-S / 未知选项），调用方退回精确匹配。
 *
 * 修复原因：env -S（--split-string）会把它的值重新切分成真正执行的命令行。之前只识别精确的
 * `-S` 与 `--split-string`，粘连（`-Ssh -c id`）、合并（`-vS…`、`-iS`）和 GNU 允许的长选项缩写
 * （`--split=`、`--sp=`）都被当作普通选项跳过，生成的稳定前缀（如 `env git status`）会让保存过的
 * 规则放行任意 `env -S <其它命令> git status`。
 * 修复依据：按 GNU env 的选项表白名单解析短选项簇与长选项前缀，遇到 -S 或未知选项一律不生成前缀。
 */
export function consumeEnvOption(argv: readonly string[], index: number): number | undefined {
  const token = argv[index]!;
  if (token === "--") return 1;
  if (token === "-") return 1;
  if (token.startsWith("--")) {
    const separator = token.indexOf("=");
    const name = separator < 0 ? token : token.slice(0, separator);
    const candidates = Object.keys(ENV_LONG_OPTIONS).filter((option) => option.startsWith(name));
    const option =
      name in ENV_LONG_OPTIONS ? name : candidates.length === 1 ? candidates[0] : undefined;
    const kind = option === undefined ? undefined : ENV_LONG_OPTIONS[option];
    if (kind === undefined || kind === "split") return undefined;
    return kind === "required" && separator < 0 ? 2 : 1;
  }
  if (!token.startsWith("-")) return 0;
  for (let charIndex = 1; charIndex < token.length; charIndex += 1) {
    const flag = token[charIndex]!;
    if (ENV_SHORT_FLAGS.has(flag)) continue;
    if (ENV_SHORT_VALUE_OPTIONS.has(flag)) return charIndex === token.length - 1 ? 2 : 1;
    return undefined;
  }
  return 1;
}
