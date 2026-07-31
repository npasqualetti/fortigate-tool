#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RELEASE_DIR="$ROOT/release"
PACKAGE_DIR="$RELEASE_DIR/bp-fortinet-rbac-windows"
ZIP_PATH="$RELEASE_DIR/bp-fortinet-rbac-windows.zip"
CACHE_DIR="$RELEASE_DIR/cache"
NODE_ZIP="$CACHE_DIR/node-v22.22.3-win-x64.zip"
SQLITE_TAR="$CACHE_DIR/better-sqlite3-v12.10.0-node-v127-win32-x64.tar.gz"

if [[ ! -f "$NODE_ZIP" ]]; then
  echo "Missing Windows Node bundle: $NODE_ZIP"
  echo "Download node-v22.22.3-win-x64.zip into release/cache/ before packaging."
  exit 1
fi

if [[ ! -f "$SQLITE_TAR" ]]; then
  echo "Missing Windows better-sqlite3 bundle: $SQLITE_TAR"
  echo "Download the win32 x64 prebuild into release/cache/ before packaging."
  exit 1
fi

echo "Running production build..."
npm run build

if [[ ! -f "$ROOT/.next/standalone/server.js" ]]; then
  echo "Missing standalone build after npm run build."
  exit 1
fi

BUILD_STAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
GIT_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "no-git")"

echo "Building fresh Windows release package..."

rm -rf "$PACKAGE_DIR" "$ZIP_PATH" "$CACHE_DIR/better-win"
mkdir -p "$PACKAGE_DIR" "$CACHE_DIR/better-win"

cp -a "$ROOT/.next/standalone/." "$PACKAGE_DIR/"
rm -rf \
  "$PACKAGE_DIR/.local" \
  "$PACKAGE_DIR/release" \
  "$PACKAGE_DIR/deploy" \
  "$PACKAGE_DIR/src" \
  "$PACKAGE_DIR/tests" \
  "$PACKAGE_DIR/scripts" \
  "$PACKAGE_DIR/README.md" \
  "$PACKAGE_DIR/components.json" \
  "$PACKAGE_DIR/eslint.config.mjs" \
  "$PACKAGE_DIR/next.config.ts" \
  "$PACKAGE_DIR/postcss.config.mjs" \
  "$PACKAGE_DIR/tsconfig.json" \
  "$PACKAGE_DIR/tsconfig.tsbuildinfo"

mkdir -p "$PACKAGE_DIR/.next/static" "$PACKAGE_DIR/runtime"
cp -a "$ROOT/.next/static/." "$PACKAGE_DIR/.next/static/"

cp "$ROOT/deploy/windows/start.bat" "$PACKAGE_DIR/start.bat"
cp "$ROOT/deploy/windows/install-startup-task.bat" "$PACKAGE_DIR/install-startup-task.bat"
cp "$ROOT/deploy/windows/verify-deploy.bat" "$PACKAGE_DIR/verify-deploy.bat"
cp "$ROOT/deploy/windows/README-FIRST-RUN.txt" "$PACKAGE_DIR/README-FIRST-RUN.txt"
cp "$ROOT/deploy/windows/.env.first-run" "$PACKAGE_DIR/.env.example"
rm -f "$PACKAGE_DIR/.env"
cat > "$PACKAGE_DIR/BUILD_INFO.txt" <<EOF
built_utc=$BUILD_STAMP
git_sha=$GIT_SHA
features=firewall-workspace,mobile-nav,responsive-admin
EOF

rm -rf "$PACKAGE_DIR/data"
mkdir -p "$PACKAGE_DIR/data"

unzip -p "$NODE_ZIP" node-v22.22.3-win-x64/node.exe > "$PACKAGE_DIR/runtime/node.exe"
chmod +x "$PACKAGE_DIR/runtime/node.exe"

tar -xzf "$SQLITE_TAR" -C "$CACHE_DIR/better-win"
cp "$CACHE_DIR/better-win/build/Release/better_sqlite3.node" \
  "$PACKAGE_DIR/node_modules/better-sqlite3/build/Release/better_sqlite3.node"

(
  cd "$RELEASE_DIR"
  zip -qr bp-fortinet-rbac-windows.zip bp-fortinet-rbac-windows
)

echo "Created $ZIP_PATH"
ls -lh "$ZIP_PATH"
