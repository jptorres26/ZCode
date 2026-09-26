const packageDirName = "zcode";

export function installScriptSource(baseUrl) {
  return `#!/usr/bin/env sh
set -eu

BASE_URL="\${ZCODE_DIST_BASE_URL:-${baseUrl}}"
INSTALL_DIR="\${ZCODE_DIST_HOME:-$HOME/.zcode/runtime}"
BIN_DIR="\${ZCODE_DIST_BIN_DIR:-$HOME/.local/bin}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "zcode install requires $1" >&2
    exit 1
  fi
}

need_cmd node
need_cmd curl
need_cmd tar

LATEST_JSON="$(curl -fsSL "\${BASE_URL%/}/latest.json")"
VERSION="$(printf '%s' "$LATEST_JSON" | node -e "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(data).version))")"
TARBALL="$(printf '%s' "$LATEST_JSON" | node -e "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(data).tarball))")"
SHA256="$(printf '%s' "$LATEST_JSON" | node -e "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write(String(JSON.parse(data).sha256||'')))")"

# latest.json 来自网络；version/tarball 会拼进 rm -rf 与 mv 的路径，必须限制为安全字符，
# 否则形如 "../.." 的 version 会删除 $INSTALL_DIR 之外的目录。
case "$VERSION" in
  ''|.|..|*[!A-Za-z0-9._-]*) echo "zcode install: invalid version in latest.json" >&2; exit 1 ;;
esac
case "$TARBALL" in
  ''|.|..|*[!A-Za-z0-9._-]*) echo "zcode install: invalid tarball name in latest.json" >&2; exit 1 ;;
esac

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ARCHIVE="$TMP_DIR/$TARBALL"
curl -fL "\${BASE_URL%/}/releases/$VERSION/$TARBALL" -o "$ARCHIVE"

# build-zcode 会把 sha256 写入 latest.json，但安装脚本此前从不校验：
# 传输截断或损坏的发行包会被直接解压并执行。
# 注意：sha256 与发行包来自同一分发源，只能发现截断/损坏，不能防御被控制的分发服务器。
if [ -z "$SHA256" ]; then
  echo "zcode install: latest.json has no sha256; refusing to install an unverified archive" >&2
  exit 1
fi
ACTUAL_SHA256="$(node -e "const c=require('crypto'),f=require('fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))" "$ARCHIVE")"
if [ "$ACTUAL_SHA256" != "$SHA256" ]; then
  echo "zcode install: checksum mismatch for $TARBALL" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/releases" "$BIN_DIR"
TARGET="$INSTALL_DIR/releases/$VERSION"
rm -rf "$TARGET.new"
mkdir -p "$TARGET.new"
tar -xzf "$ARCHIVE" -C "$TARGET.new"
rm -rf "$TARGET"
mv "$TARGET.new/${packageDirName}" "$TARGET"
rm -rf "$TARGET.new"
ln -sfn "$TARGET" "$INSTALL_DIR/current"

cat > "$BIN_DIR/zcode" <<SH
#!/usr/bin/env sh
exec node "$INSTALL_DIR/current/bin/zcode.mjs" "\\$@"
SH
chmod +x "$BIN_DIR/zcode"

echo "ZCode $VERSION installed."
echo "Run: zcode (TUI) or zcode --web (Web)"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Note: $BIN_DIR is not in PATH." ;;
esac
`;
}
