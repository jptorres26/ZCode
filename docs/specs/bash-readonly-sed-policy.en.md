# Bash read-only policy: sed script classification

> English translation of [bash-readonly-sed-policy.md](bash-readonly-sed-policy.md). The Chinese file is the normative source; keep both in sync.

## Rules

Read-only auto-approval (`isRuntimeReadOnlyBashCommand`) only accepts sed invocations that are
**fully parsed and neither write files nor execute commands**. Implementation:
`apps/zcode-cli/packages/core/src/tool/handlers/bash-readonly-policy-sed.ts`.

- Options: only `-n -E -r -s -u -z -e -l` and their clustered forms, `--expression`, and other
  side-effect-free long options (including unambiguous prefixes GNU accepts). `-i` / `--in-place`
  (including clustered forms such as `-ni` and the `--in` abbreviation), `-f` / `--file` (the script
  cannot be inspected), and unknown options are never auto-approved.
- Script sources: every `-e` / `--expression` (including `-escript`, `-ne script`, `-nes/..`);
  without `-e`, the first operand. Each script is checked on its own and, when there are several,
  once more joined with newlines as GNU does.
- Scripts are scanned in linear time following GNU sed 4.9 syntax: addresses (line numbers, `$`,
  `first~step`, `/re/` and `\cREc` with `I`/`M` flags, `addr,+N`, `addr,~N`), `!`, commands, and
  their arguments; bracket expressions in regexes follow POSIX rules (a backslash inside is literal).
- Dangerous: the `w`, `W`, and `e` commands, and the `w` and `e` flags of `s` (whitespace is allowed
  before flags). `r` and `R` only read files and count as read-only.
- Undecidable: unknown commands, unterminated regexes/brackets/classes, extra characters after a
  command, `[` / `]` / `\` / newline as a delimiter, and so on are all treated as dangerous
  (fail-closed) and go to permission confirmation.

## Acceptance

`apps/zcode-cli/packages/core/test/bashReadonlySedPolicy.test.ts`: every known bypass is no longer
auto-approved; common read-only scripts stay auto-approved; backslash-heavy input completes in
linear time. The scanner was also compared against GNU `sed --sandbox` on random scripts (none of
40,000 scripts judged read-only contained an e/w command).
