/**
 * sed 只读判定：识别会写文件（w / W 命令、s///w）或执行命令（e 命令、s///e）的脚本。
 *
 * 修复原因：原实现用正则黑名单匹配 `w` / `e`，既漏掉了无空格（`wout`）、s 标志前的空格
 * （`s/a/b/ w out`）、地址标志（`/a/Iw out`）、非常规分隔符（`s a b w out`）、方括号内的分隔符
 * （`s/[/]/x/w out`）与粘连的 `-e` 选项，又因地址正则 `(?:\\.|[^\/\n])*` 对反斜杠有歧义，
 * 构造的输入会让同步策略检查回溯 20 秒以上（ReDoS）。
 * 修复依据：按 GNU sed 4.9 的语法逐字符扫描（线性时间），只有完整解析且不含写入/执行的脚本才算只读；
 * 任何无法确定的语法都按危险处理（fail-closed），交给权限确认。
 */

class SedScriptParseError extends Error {}

const SED_SIMPLE_COMMANDS = new Set([
  "=",
  "d",
  "D",
  "g",
  "G",
  "h",
  "H",
  "n",
  "N",
  "p",
  "P",
  "x",
  "z",
  "F",
]);
const SED_NUMERIC_ARG_COMMANDS = new Set(["l", "L", "q", "Q"]);
const SED_LABEL_COMMANDS = new Set(["b", "t", "T"]);
const SED_TEXT_COMMANDS = new Set(["a", "i", "c"]);
const SED_READ_FILE_COMMANDS = new Set(["r", "R"]);
const SED_WRITE_OR_EXEC_COMMANDS = new Set(["w", "W", "e"]);
const SED_SUBSTITUTE_FLAGS = new Set(["g", "p", "i", "I", "m", "M"]);
const SED_ADDRESS_REGEX_FLAGS = new Set(["I", "M"]);
const SED_END_OF_COMMAND = new Set([";", "\n", "}", "#"]);
const SED_UNSUPPORTED_DELIMITERS = new Set(["\n", "\\", "[", "]"]);

const SED_LONG_OPTIONS = [
  "--debug",
  "--expression",
  "--file",
  "--follow-symlinks",
  "--help",
  "--in-place",
  "--line-length",
  "--null-data",
  "--zero-terminated",
  "--posix",
  "--quiet",
  "--silent",
  "--regexp-extended",
  "--sandbox",
  "--separate",
  "--unbuffered",
  "--version",
] as const;
const SED_SAFE_SHORT_FLAGS = new Set(["n", "E", "r", "s", "u", "z"]);

class SedScriptScanner {
  private index = 0;

  constructor(private readonly script: string) {}

  /** 返回脚本是否包含写文件或执行命令；语法无法确定时抛出 SedScriptParseError。 */
  scan(): boolean {
    for (;;) {
      this.skipWhile((char) => char === " " || char === "\t" || char === ";" || char === "\n");
      if (this.atEnd()) return false;
      this.readAddresses();
      this.skipBlanks();
      while (this.peek() === "!") {
        this.index += 1;
        this.skipBlanks();
      }
      if (this.readCommand()) return true;
    }
  }

  private readCommand(): boolean {
    const command = this.next();
    if (command === "{") return false;
    if (command === "}" || SED_SIMPLE_COMMANDS.has(command)) return this.expectEndOfCommand();
    if (SED_WRITE_OR_EXEC_COMMANDS.has(command)) return true;
    if (command === "#") return this.skipLine();
    if (SED_READ_FILE_COMMANDS.has(command) || SED_TEXT_COMMANDS.has(command)) {
      return this.skipTextLine();
    }
    if (SED_NUMERIC_ARG_COMMANDS.has(command)) {
      this.skipBlanks();
      this.skipWhile(isDigit);
      return this.expectEndOfCommand();
    }
    if (SED_LABEL_COMMANDS.has(command) || command === ":" || command === "v") {
      this.skipBlanks();
      this.skipWhile((char) => !isBlankOrSeparator(char) && char !== "}");
      return this.expectEndOfCommand();
    }
    if (command === "s") return this.readSubstitute();
    if (command === "y") {
      const delimiter = this.readDelimiter();
      this.readDelimited(delimiter, false);
      this.readDelimited(delimiter, false);
      return this.expectEndOfCommand();
    }
    throw new SedScriptParseError(`unknown sed command: ${command}`);
  }

  private readSubstitute(): boolean {
    const delimiter = this.readDelimiter();
    this.readDelimited(delimiter, true);
    this.readDelimited(delimiter, false);
    for (;;) {
      this.skipBlanks();
      const flag = this.peek();
      if (flag === "w" || flag === "e") return true;
      if (flag !== undefined && SED_SUBSTITUTE_FLAGS.has(flag)) {
        this.index += 1;
        continue;
      }
      if (flag !== undefined && isDigit(flag)) {
        this.skipWhile(isDigit);
        continue;
      }
      return this.expectEndOfCommand();
    }
  }

  private readAddresses(): void {
    if (!this.readAddress()) return;
    this.skipBlanks();
    if (this.peek() !== ",") return;
    this.index += 1;
    this.skipBlanks();
    const step = this.peek();
    if (step === "+" || step === "~") {
      this.index += 1;
      if (!isDigit(this.peek())) throw new SedScriptParseError("expected address step");
      this.skipWhile(isDigit);
      return;
    }
    if (!this.readAddress()) throw new SedScriptParseError("expected second address");
  }

  private readAddress(): boolean {
    const char = this.peek();
    if (char === "$") {
      this.index += 1;
      return true;
    }
    if (isDigit(char)) {
      this.skipWhile(isDigit);
      if (this.peek() === "~") {
        this.index += 1;
        this.skipWhile(isDigit);
      }
      return true;
    }
    if (char !== "/" && char !== "\\") return false;
    this.index += 1;
    const delimiter = char === "/" ? "/" : this.readDelimiter();
    this.readDelimited(delimiter, true);
    this.skipWhile((flag) => SED_ADDRESS_REGEX_FLAGS.has(flag));
    return true;
  }

  private readDelimiter(): string {
    const delimiter = this.next();
    if (SED_UNSUPPORTED_DELIMITERS.has(delimiter)) {
      throw new SedScriptParseError("unsupported delimiter");
    }
    return delimiter;
  }

  /** 读取到未转义的分隔符为止；正则段按 POSIX 规则跳过方括号表达式（其中的反斜杠是字面量）。 */
  private readDelimited(delimiter: string, isRegex: boolean): void {
    while (!this.atEnd()) {
      const char = this.next();
      if (char === delimiter) return;
      if (char === "\n") throw new SedScriptParseError("newline inside delimited section");
      if (char === "\\") {
        if (this.atEnd()) throw new SedScriptParseError("trailing backslash");
        this.index += 1;
        continue;
      }
      if (isRegex && char === "[") this.skipBracketExpression();
    }
    throw new SedScriptParseError("unterminated delimited section");
  }

  private skipBracketExpression(): void {
    if (this.peek() === "^") this.index += 1;
    if (this.peek() === "]") this.index += 1;
    while (!this.atEnd()) {
      const char = this.next();
      if (char === "]") return;
      if (char === "\n") throw new SedScriptParseError("newline inside bracket expression");
      if (char === "[" && (this.peek() === ":" || this.peek() === "=" || this.peek() === ".")) {
        const terminator = `${this.next()}]`;
        const end = this.script.indexOf(terminator, this.index);
        if (end < 0) throw new SedScriptParseError("unterminated character class");
        this.index = end + terminator.length;
      }
    }
    throw new SedScriptParseError("unterminated bracket expression");
  }

  private expectEndOfCommand(): boolean {
    this.skipBlanks();
    const char = this.peek();
    if (char !== undefined && !SED_END_OF_COMMAND.has(char)) {
      throw new SedScriptParseError(`extra characters after command: ${char}`);
    }
    return false;
  }

  /** a / i / c 文本与 r / R 文件名延续到未转义的换行（行尾 `\` 续行）。 */
  private skipTextLine(): boolean {
    while (!this.atEnd()) {
      const char = this.next();
      if (char === "\\") {
        this.index += 1;
        continue;
      }
      if (char === "\n") return false;
    }
    return false;
  }

  private skipLine(): boolean {
    this.skipWhile((char) => char !== "\n");
    return false;
  }

  private skipBlanks(): void {
    this.skipWhile((char) => char === " " || char === "\t");
  }

  private skipWhile(predicate: (char: string) => boolean): void {
    while (!this.atEnd() && predicate(this.script[this.index]!)) this.index += 1;
  }

  private peek(): string | undefined {
    return this.script[this.index];
  }

  private next(): string {
    const char = this.script[this.index];
    if (char === undefined) throw new SedScriptParseError("unexpected end of script");
    this.index += 1;
    return char;
  }

  private atEnd(): boolean {
    return this.index >= this.script.length;
  }
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function isBlankOrSeparator(char: string): boolean {
  return char === " " || char === "\t" || char === ";" || char === "\n";
}

/** 脚本可能写文件或执行命令时返回 true；无法完整解析时同样返回 true（fail-closed）。 */
export function sedScriptMayWriteOrExecute(script: string): boolean {
  try {
    return new SedScriptScanner(script).scan();
  } catch (error) {
    if (error instanceof SedScriptParseError) return true;
    throw error;
  }
}

function resolveSedLongOption(name: string): string | undefined {
  if ((SED_LONG_OPTIONS as readonly string[]).includes(name)) return name;
  // GNU getopt_long 接受无歧义的前缀缩写（如 --expr、--in）。
  const candidates = SED_LONG_OPTIONS.filter((option) => option.startsWith(name));
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function isSedInPlaceOption(word: string): boolean {
  if (word.startsWith("--")) {
    const name = word.split("=", 1)[0] ?? word;
    return name.length > 2 && resolveSedLongOption(name) === "--in-place";
  }
  if (!word.startsWith("-") || word.length < 2) return false;
  // 短选项可以合并（-ni），但 -e / -f / -l 之后的字符是选项值而不是选项。
  for (const char of word.slice(1)) {
    if (char === "i") return true;
    if (char === "e" || char === "f" || char === "l") return false;
  }
  return false;
}

interface SedArgvScripts {
  scripts: string[];
  /** 出现了无法静态检查的选项（-f、-i、未知选项）。 */
  uninspectable: boolean;
}

function collectSedScripts(args: readonly string[]): SedArgvScripts {
  const scripts: string[] = [];
  const operands: string[] = [];
  let hasExpression = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--") {
      operands.push(...args.slice(index + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const separator = arg.indexOf("=");
      const option = resolveSedLongOption(separator < 0 ? arg : arg.slice(0, separator));
      const inlineValue = separator < 0 ? undefined : arg.slice(separator + 1);
      if (option === undefined || option === "--file" || option === "--in-place") {
        return { scripts, uninspectable: true };
      }
      if (option === "--expression") {
        hasExpression = true;
        scripts.push(inlineValue ?? args[(index += 1)] ?? "");
      } else if (option === "--line-length" && inlineValue === undefined) {
        index += 1;
      }
      continue;
    }
    if (!arg.startsWith("-") || arg === "-") {
      operands.push(arg);
      continue;
    }
    for (let charIndex = 1; charIndex < arg.length; charIndex += 1) {
      const flag = arg[charIndex]!;
      const rest = arg.slice(charIndex + 1);
      if (flag === "e") {
        hasExpression = true;
        scripts.push(rest.length > 0 ? rest : (args[(index += 1)] ?? ""));
        break;
      }
      if (flag === "l") {
        if (rest.length === 0) index += 1;
        break;
      }
      if (!SED_SAFE_SHORT_FLAGS.has(flag)) return { scripts, uninspectable: true };
    }
  }
  if (!hasExpression && operands.length > 0) scripts.push(operands[0]!);
  return { scripts, uninspectable: false };
}

export function sedCommandIsDangerous(_commandText: string, args: readonly string[]): boolean {
  const { scripts, uninspectable } = collectSedScripts(args);
  if (uninspectable) return true;
  // GNU sed 把多个 -e 用换行拼接后再解析；分别检查与拼接后检查都必须通过。
  return (
    scripts.some(sedScriptMayWriteOrExecute) ||
    (scripts.length > 1 && sedScriptMayWriteOrExecute(scripts.join("\n")))
  );
}
