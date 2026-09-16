#!/data/data/com.termux/files/usr/bin/bash
# setup-root.sh — one-tap DSH install inside Termux (root edition, no PC proxy).
# Idempotent: safe to re-run. Full log: ~/setup-dsh.log (tee'd).
# The API key is taken from the DEEPSEEK_API_KEY env var only — never embedded.
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export TMPDIR=$PREFIX/tmp
export TERMUX_APP_PACKAGE=com.termux
export PATH=$PREFIX/bin:$PREFIX/bin/applets:/system/bin:/system/xbin
export LD_LIBRARY_PATH=$PREFIX/lib

: > "$HOME/setup-dsh.log"
set -eo pipefail
{
  # Fast path: a previous run completed (marker) and node+DSH are still there
  # -> skip apt/npm downloads entirely (seconds instead of minutes).
  FAST=""
  if [ -f "$HOME/.dsh-setup-ok" ] && [ -x "$PREFIX/bin/node" ]      && [ -f "$PREFIX/lib/node_modules/@deepseek-ai/dsh/package.json" ]; then
    FAST=1
    echo "[fast] 环境已就绪，跳过 apt/npm 下载（强制重装请删除 ~/.dsh-setup-ok）"
  fi

  if [ -z "$FAST" ]; then
  echo "[step] write TUNA apt source"
  cat > "$PREFIX/etc/apt/sources.list" << 'EOF'
# TUNA mirror (Termux main repo)
deb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main stable main
EOF

  echo "[step] apt-get update"
  apt-get update

  echo "[step] install base packages"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -o Dpkg::Options::=--force-confold nodejs-lts git python clang make binutils openssl curl wget termux-api

  echo "[step] node/npm versions"
  node -v
  npm -v

  echo "[step] npm retry hardening"
  npm config set fetch-retries 5
  npm config set fetch-retry-mintimeout 20000
  npm config set fetch-retry-maxtimeout 120000

  echo "[step] install DSH (ignore scripts; native modules patched later; registry fallback chain)"
  # npmmirror -> Huawei Cloud -> official npmjs. VPN fake-ip / flaky WiFi proofing.
  DSH_INSTALLED=""
  for REG in https://registry.npmmirror.com https://repo.huaweicloud.com/repository/npm/ https://registry.npmjs.org; do
    echo "[step] trying registry: $REG"
    if npm install -g --ignore-scripts --registry "$REG" @deepseek-ai/dsh@latest; then
      npm config set registry "$REG"
      DSH_INSTALLED=1
      break
    fi
    echo "[fallback] registry $REG failed — patching koffi if present, then trying next"
    KOFFI_CC="$(npm root -g)/@deepseek-ai/dsh/node_modules/koffi/lib/native/base/base.cc"
    if [ -f "$KOFFI_CC" ] && ! grep -q 'ANDROID' "$KOFFI_CC"; then
      sed -i 's/#if defined(__linux__)/#if defined(__linux__) && !defined(__ANDROID__)/' "$KOFFI_CC"
    fi
  done
  if [ -z "$DSH_INSTALLED" ]; then
    echo "[error] all npm registries failed; aborting"
    exit 1
  fi
  fi  # end fast-skip

  DSH_DIR="$(npm root -g)/@deepseek-ai/dsh"
  echo "DSH_DIR=$DSH_DIR"

  # The dependency copies live in one of two places, and the patches below must not
  # assume either one:
  #   * a normal `npm install -g` nests them at $DSH_DIR/node_modules/@deepseek-ai;
  #   * an install that is a path symlink into a hand-built/pnpm tree (what
  #     scripts/upgrade-to-015.sh produces) keeps the launcher inside the project's
  #     node_modules, so its siblings are the packages. Assuming the nested path
  #     there aborts the whole deploy with ENOENT on the first patch.
  DSH_REAL=$(readlink -f "$DSH_DIR")
  if [ -d "$DSH_REAL/node_modules/@deepseek-ai" ]; then
    SCOPE_DIR="$DSH_REAL/node_modules/@deepseek-ai"
    MODROOT="$DSH_REAL/node_modules"
  else
    SCOPE_DIR="$(dirname "$DSH_REAL")"
    MODROOT="$(dirname "$SCOPE_DIR")"
  fi
  echo "SCOPE_DIR=$SCOPE_DIR"

  echo "[step] patch koffi statx for Android"
  KOFFI_CC="$MODROOT/koffi/lib/native/base/base.cc"
  if [ -f "$KOFFI_CC" ] && ! grep -q 'ANDROID' "$KOFFI_CC"; then
    sed -i 's/#if defined(__linux__)/#if defined(__linux__) && !defined(__ANDROID__)/' "$KOFFI_CC"
    echo "[ok] koffi patched"
  else
    echo "[skip] koffi patch (already applied or file missing)"
  fi

  echo "[step] sharp wasm fallback"
  if [ -z "$FAST" ]; then
    cd "$DSH_DIR"
    npm install @img/sharp-wasm32 --no-save 2>/dev/null || echo "[warn] sharp-wasm32 skipped"
  else
    echo "[skip] sharp wasm (fast path, already installed)"
  fi

  echo "[step] patch node-pty lazy load"
  if [ -f "$SCOPE_DIR/dsh-subprocess-local/lib/index.js" ]; then
    node "$HOME/patch-dsh.mjs" "$SCOPE_DIR/dsh-subprocess-local/lib/index.js"
  else
    echo "[warn] dsh-subprocess-local 不存在 —— 跳过"
  fi

  echo "[step] patch session/attachment publish (link -> rename, Android SELinux denies link)"
  node "$HOME/patch-dsh-link.mjs" "$SCOPE_DIR"

  echo "[step] patch client-modules composer (phone-sized CPU; 0.1.5+ only)"
  # 0.1.5 synthesises a per-line identity source map per module and recomposes every
  # client bundle on every plugin registration. On a phone that never converges
  # (measured: 225s of CPU, UI never renders); this degrades the map to an empty one
  # and debounces the flush.
  node "$HOME/patch-dsh-client-modules.mjs" "$SCOPE_DIR/dsh-client-modules/lib/index.js" || \
    echo "[warn] client-modules 补丁未生效（目标缺失，或该版本锚点已变）"

  echo "[step] patch web auth (loopback stays token-free; 0.1.5+ only)"
  # 0.1.5 gates the UI and /api behind a per-process launch token. The shell WebView
  # cannot pass it, so loopback would answer 401 forever. LAN still needs the token.
  node "$HOME/patch-dsh-web-auth.mjs" "$SCOPE_DIR/dsh-client-connection/lib/index.js" || \
    echo "[warn] web-auth 补丁未生效（目标缺失，或该版本锚点已变）"

  echo "[step] patch flock native module (Android app uids have no flock(2))"
  # 0.1.5 takes a cross-process lock through @deepseek-ai/node-addon-system on every
  # durable session write. On Android the addon throws ERR_FLOCK_UNSUPPORTED_PLATFORM,
  # so the session log is never written and the turn dies silently right after
  # session/prompt answers accepted:true (looks like "nothing happens", not an error).
  if [ -f "$HOME/patch-dsh-flock-android.mjs" ]; then
    node "$HOME/patch-dsh-flock-android.mjs" "$SCOPE_DIR/node-addon-system/lib/flock.js" || \
      echo "[warn] node-addon-system/flock.js not present — skipped"
  else
    echo "[warn] payload 里没有 patch-dsh-flock-android.mjs（旧 APK？）"
  fi

  echo "[step] convert user Agent presets to the 0.1.5 persona key"
  # 0.1.5's @deepseek-ai/dsh-persona made the prompt key required and renamed it
  # text -> prefix. A preset still saying `text` fails to mount, and every session
  # created from it refuses to start (`$.prefix missing required value`).
  if [ -f "$HOME/patch-dsh-presets.mjs" ] && [ -d "$HOME/.dsh/.agent-presets" ]; then
    node "$HOME/patch-dsh-presets.mjs" "$HOME/.dsh/.agent-presets" || echo "[warn] preset conversion failed"
  elif [ -f "$HOME/patch-dsh-presets.mjs" ]; then
    echo "[skip] 还没有用户预设目录"
  else
    echo "[warn] payload 里没有 patch-dsh-presets.mjs（旧 APK？）"
  fi

  echo "[step] dsh-mnemon version floor (0.1.5 needs >= 0.5)"
  # dsh-mnemon < 0.5 against 0.1.5 throws
  # "Cannot read properties of undefined (reading 'filter')" from the turn-stopping
  # hook: the model has already answered, so it shows up as an error on a good reply.
  MNEMON_PKG="$HOME/.dsh/profiles/web/node_modules/dsh-mnemon/package.json"
  if [ -f "$MNEMON_PKG" ]; then
    MNEMON_V=$(node -e "process.stdout.write(require('$MNEMON_PKG').version)" 2>/dev/null || echo "")
    case "$MNEMON_V" in
      0.[0-4].*|"")
        echo "[fix] dsh-mnemon $MNEMON_V -> 0.5.10"
        ( cd "$HOME/.dsh/profiles/web" && pnpm add dsh-mnemon@0.5.10 --reporter=append-only ) || \
          echo "[warn] pnpm add dsh-mnemon 失败（网络？）—— 0.1.5 下每轮收尾会报错"
        ;;
      *) echo "[skip] dsh-mnemon $MNEMON_V 已满足" ;;
    esac
  else
    echo "[skip] web profile 里没装 dsh-mnemon"
  fi

  echo "[step] register dsh-android-control plugin"
  PLUGIN_DIR="$MODROOT/dsh-android-control"
  mkdir -p "$PLUGIN_DIR/lib"
  install -m 644 "$HOME/plugin/index.js" "$HOME/plugin/package.json" "$HOME/plugin/cordis.patch.yml" "$PLUGIN_DIR/"
  install -m 644 "$HOME/plugin/lib/client.js" "$PLUGIN_DIR/lib/"
  mkdir -p "$HOME/.dsh/profiles/web/node_modules"
  ln -sfn "$PLUGIN_DIR" "$HOME/.dsh/profiles/web/node_modules/dsh-android-control"

  echo "[step] write web profile cordis patch"
  mkdir -p "$HOME/.dsh/profiles/web"
  install -m 644 "$HOME/cordis.patch.yml" "$HOME/.dsh/profiles/web/cordis.patch.yml"

  echo "[step] install dsh-watchdog (root: keeps dns-fwd and dsh web alive)"
  # Without it a dead dns-fwd leaves the :53 redirect pointing at nothing and the
  # whole phone loses DNS (DSH turns then fail with TRANSPORT); a killed dsh web
  # leaves the app's one-shot WebView on the white "DSH 还没起来" page.
  if [ -f "$HOME/dsh-watchdog.sh" ]; then
    if su -c "cp $HOME/dsh-watchdog.sh /data/adb/service.d/dsh-watchdog.sh && chmod 755 /data/adb/service.d/dsh-watchdog.sh" 2>/dev/null; then
      # Launch only when no loop is already alive. The script's own pidfile guard is
      # not enough here: a stale pidfile from a manual start makes the guard pass and
      # leaves two watchers probing/reviving in parallel.
      if su -c "pgrep -f dsh-watchdog[.]sh >/dev/null 2>&1"; then
        echo "[ok] dsh-watchdog 已在运行（跳过重复启动）"
      else
        su -c "setsid sh /data/adb/service.d/dsh-watchdog.sh watch >/dev/null 2>&1 &" 2>/dev/null
        echo "[ok] dsh-watchdog 已安装并启动（日志 /data/adb/dsh-watchdog.log）"
      fi
    else
      echo "[warn] dsh-watchdog 安装失败（/data/adb/service.d 不可用？仍是 root 吗）"
    fi
  else
    echo "[warn] payload 里没有 dsh-watchdog.sh（旧 APK？）"
  fi

  echo "[step] write API key"
  if [ -n "$DEEPSEEK_API_KEY" ] && printf '%s' "$DEEPSEEK_API_KEY" | grep -Eq '^sk-[A-Za-z0-9_-]+$'; then
    printf '%s' "$DEEPSEEK_API_KEY" > "$HOME/.dsh-api-key"
    chmod 600 "$HOME/.dsh-api-key"
    echo "[ok] API key saved to ~/.dsh-api-key (chmod 600)"
  elif [ -n "$DEEPSEEK_API_KEY" ]; then
    echo "[error] DEEPSEEK_API_KEY 格式非法（应为 sk- 开头的纯文本，不含换行）；未写入"
    exit 1
  else
    echo "[skip] DEEPSEEK_API_KEY not set"
  fi

  echo "[step] grant Termux:API hardware permissions (camera/mic/location)"
  # 硬件工具（plugin v2）依赖 Termux:API 的运行时权限；逐项 pm grant，幂等可重跑。
  # 0.53 版 Termux:API 只声明了这 4 个危险权限；通知 targetSdk=28 无需 POST_NOTIFICATIONS；
  # wakelock 走 Termux 应用自身的 TermuxService（WAKE_LOCK 随 Termux 安装授予）；震动随安装授予。
  API_RUNTIME_PERMS="android.permission.CAMERA android.permission.RECORD_AUDIO android.permission.ACCESS_FINE_LOCATION android.permission.ACCESS_COARSE_LOCATION"
  for P in $API_RUNTIME_PERMS; do
    if su -c "pm grant com.termux.api $P" 2>/dev/null; then
      echo "[ok] pm grant com.termux.api $P"
    else
      echo "[warn] pm grant 失败: $P（可到 Termux:API 应用详情页手动开启，一次终身）"
    fi
  done
  echo "[ok] 通知无需授权：Termux:API targetSdk=28，系统默认放行通知"
  echo "[ok] wakelock 走 com.termux TermuxService（WAKE_LOCK 已随 Termux 安装授予）"
  echo "[ok] 震动 VIBRATE 已随 Termux:API 安装自动授予"
  if su -c "cmd appops set com.termux.api WRITE_SETTINGS allow" 2>/dev/null; then
    echo "[ok] appops allow com.termux.api WRITE_SETTINGS（termux-brightness 亮度写回退）"
  else
    echo "[warn] WRITE_SETTINGS appop 授权失败: com.termux.api（亮度写将走 su/bridge 通道）"
  fi
  if su -c "dumpsys deviceidle whitelist +com.termux.api" 2>/dev/null; then
    echo "[ok] 电池豁免 deviceidle whitelist +com.termux.api"
  else
    echo "[warn] 电池豁免失败: com.termux.api（MIUI 可能冻结 Termux:API，建议到设置里允许后台无限制）"
  fi

  echo "[step] record launcher alias"
  cat > "$HOME/.bashrc" << 'EOF'
alias dsh='node --expose-internals $(npm root -g)/@deepseek-ai/dsh/lib/bin.js'
EOF

  echo "[step] verify one real turn over the live web API"
  # Advisory only: the wizard may not have started dsh web yet. A green VERIFY_OK is
  # the only proof that the whole chain (patches + presets + mnemon) actually works;
  # run it by hand any time with: node ~/verify-turn.mjs 3080 ~
  if [ -f "$HOME/verify-turn.mjs" ] && curl -sf -o /dev/null --max-time 3 http://127.0.0.1:3080/ 2>/dev/null; then
    timeout -s KILL 180 node "$HOME/verify-turn.mjs" 3080 "$HOME" || \
      echo "[warn] 轮次验收失败 —— 见 docs/UPGRADE-0.1.5.md 第四节"
  else
    echo "[skip] dsh web 未运行；部署完可在 App 里执行 node ~/verify-turn.mjs 3080 ~ 自检"
  fi

  touch "$HOME/.dsh-setup-ok"
  echo "SETUP OK"
} 2>&1 | tee -a "$HOME/setup-dsh.log"
