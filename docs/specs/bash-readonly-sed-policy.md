# Bash 只读策略：sed 脚本判定

> 英文版：[bash-readonly-sed-policy.en.md](bash-readonly-sed-policy.en.md)。本文件为规范来源，两者保持同步。

## 规则

只读自动放行（`isRuntimeReadOnlyBashCommand`）只接受**完整解析且不写文件、不执行命令**的
sed 调用。实现：`apps/zcode-cli/packages/core/src/tool/handlers/bash-readonly-policy-sed.ts`。

- 选项：只允许 `-n -E -r -s -u -z -e -l` 及其合并形式、`--expression` 与其它无副作用的长选项
  （含 GNU 可接受的无歧义前缀缩写）。`-i` / `--in-place`（含 `-ni` 这类合并形式与 `--in` 缩写）、
  `-f` / `--file`（脚本无法静态检查）以及未知选项一律不自动放行。
- 脚本来源：所有 `-e` / `--expression`（含 `-e脚本`、`-ne 脚本`、`-nes/..`）；没有 `-e` 时取第一个操作数。
  每段脚本单独检查，多段时再按 GNU 的换行拼接检查一次。
- 脚本按 GNU sed 4.9 语法线性扫描：地址（行号、`$`、`first~step`、`/re/` 与 `\cREc` 及 `I`/`M` 标志、
  `addr,+N`、`addr,~N`）、`!`、命令及其参数；正则中的方括号表达式按 POSIX 规则处理（其中反斜杠是字面量）。
- 危险：`w`、`W`、`e` 命令，`s` 命令的 `w`、`e` 标志（标志前允许空白）。`r`、`R` 只读取文件，视为只读。
- 无法确定：未知命令、未闭合的正则/方括号/字符类、命令后的多余字符、`[`/`]`/`\`/换行作分隔符等
  一律按危险处理（fail-closed），交给权限确认。

## 验收

`apps/zcode-cli/packages/core/test/bashReadonlySedPolicy.test.ts`：已知绕过全部不再自动放行；
常见只读脚本仍自动放行；反斜杠密集输入在线性时间内完成。另以 GNU `sed --sandbox`
作为判定依据做过随机脚本对比（4 万条被判为只读的脚本均无 e/w 命令）。
