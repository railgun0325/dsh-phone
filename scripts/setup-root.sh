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

set -Eeuo pipefail
umask 077
# UID switching alone does not enter the Termux SELinux app domain. Refuse
# before creating logs/npm files when the caller is still in su/shell context.
if [ "$(id -u)" = 0 ]; then
  echo "[error] Run this script in ordinary Termux, not a root shell."
  exit 1
fi
PROCESS_CONTEXT=$(cat /proc/self/attr/current)
REFERENCE_CONTEXT=$(stat -c %C /data/data/com.termux)
case "$PROCESS_CONTEXT" in
  u:r:untrusted_app*:s0:c*|u:r:runas_app:s0:c*) ;;
  *) echo "[error] Installer remains in an unsafe SELinux domain ($PROCESS_CONTEXT). Open ordinary Termux and run bash ~/setup-root.sh."; exit 1 ;;
esac
case "$REFERENCE_CONTEXT" in u:object_r:app_data_file:s0:c*) ;; *) echo "[error] missing trusted Termux MCS reference"; exit 1;; esac
[ "${PROCESS_CONTEXT#*:s0:}" = "${REFERENCE_CONTEXT#*:s0:}" ] || { echo "[error] process/Termux MCS categories differ"; exit 1; }
[ -f "$HOME/root-install-selinux.sh" ] || { echo "[error] missing root-install-selinux.sh payload"; exit 1; }
# Repair only existing managed log/lock paths before opening them. Full package
# repair waits for the installer lock, so concurrent installs never mutate trees.
su -c "sh '$HOME/root-install-selinux.sh' '$(id -u)' '$(id -g)' bootstrap"
mkdir -p "$HOME/.dsh-install-logs"
LOG="$HOME/.dsh-install-logs/setup-$(date +%Y%m%d-%H%M%S)-$$.log"
exec > >(tee -a "$LOG" "$HOME/setup-dsh.log") 2>&1
trap 'rc=$?; echo "[error] setup failed at line $LINENO (status $rc); log: $LOG"; exit "$rc"' ERR
{
  command -v flock >/dev/null || apt-get install -y util-linux
  exec 9>"$HOME/.dsh-install.lock"
  flock --exclusive --nonblock 9 || { echo "[error] another DSH installer holds the installation lock"; exit 1; }
  rm -f "$HOME/.dsh-setup-ok"
  # Never replace modules beneath a serving web process. Stop its watchdog first
  # in the app, then stop web; this script deliberately does not kill processes.
  if pgrep -f '[/]bin[.]js web([[:space:]]|$)' >/dev/null || curl -sf -o /dev/null --max-time 2 http://127.0.0.1:3080/; then
    echo "[error] DSH web is running. Stop web and its watchdog before installing, then rerun."
    exit 1
  fi
  # su/execAs may have created unreadable :s0 files. Repair before reading even
  # package.json, not merely before npm mutates the existing tree.
  [ -f "$HOME/root-install-selinux.sh" ] || { echo "[error] missing root-install-selinux.sh payload"; exit 1; }
  su -c "sh '$HOME/root-install-selinux.sh' '$(id -u)' '$(id -g)'"
  # Keep the user's apt sources and npm configuration unchanged.
  if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y -o Dpkg::Options::=--force-confold nodejs-lts
  fi
  command -v curl >/dev/null || apt-get install -y curl
  command -v python >/dev/null || apt-get install -y python
  command -v termux-camera-photo >/dev/null || apt-get install -y termux-api
  node -v
  npm -v
  node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("[error] DSH requires Node >=22.12; upgrade Termux nodejs-lts first"); process.exit(1); }'
  DSH_DIR="$PREFIX/lib/node_modules/@deepseek-ai/dsh"
  INSTALLED=""
  if [ -f "$DSH_DIR/package.json" ]; then
    INSTALLED=$(node -p 'require(process.argv[1]).version' "$DSH_DIR/package.json")
  fi
  DSH_VERSION="${DSH_VERSION:-${INSTALLED:-0.2.0-rc.2}}"
  case "$DSH_VERSION" in
    0.2.0-rc.1|0.2.0-rc.2) ;;
    *) echo "[error] DSH $DSH_VERSION has not been validated. Set DSH_VERSION to an explicitly supported 0.2.0 build."; exit 1 ;;
  esac
  export npm_config_cache="$HOME/.cache/dsh-phone-npm"
  DSH_NPM_REGISTRY="${DSH_NPM_REGISTRY:-https://registry.npmjs.org}"
  case "$DSH_NPM_REGISTRY" in https://*) ;; *) echo "[error] DSH_NPM_REGISTRY must use HTTPS"; exit 1;; esac
  case "${DSH_REINSTALL:-0}" in 0|1) ;; *) echo "[error] DSH_REINSTALL must be 0 or 1"; exit 1;; esac
  if [ "$INSTALLED" != "$DSH_VERSION" ] || [ "${DSH_REINSTALL:-0}" = 1 ]; then
    BACKUP=""
    if [ -n "$INSTALLED" ]; then
      mkdir -p "$HOME/.dsh-install-backups"
      BACKUP="$HOME/.dsh-install-backups/dsh-$INSTALLED-$(date +%Y%m%d-%H%M%S)-$$"
      # Move only the validated ordinary global package tree. Retain a pristine
      # retry route for legacy destructive patches, without changing user data.
      mv "$DSH_DIR" "$BACKUP"
      echo "[backup] previous DSH tree retained at $BACKUP"
    fi
    echo "[step] install exact DSH $DSH_VERSION (lifecycle scripts disabled)"
    if ! npm install -g --ignore-scripts --registry "$DSH_NPM_REGISTRY" --fetch-retries=5 "@deepseek-ai/dsh@$DSH_VERSION"; then
      if [ -n "$BACKUP" ]; then
        [ ! -e "$DSH_DIR" ] || mv "$DSH_DIR" "$BACKUP.failed-install"
        mv "$BACKUP" "$DSH_DIR"
        echo "[restore] previous package restored; partial install kept beside backup"
      fi
      echo "[error] npm installation failed; fix the reported error and rerun. Log: $LOG"
      exit 1
    fi
  else
    echo "[resume] using installed DSH $INSTALLED (DSH_REINSTALL=1 requests a backed-up clean reinstall)"
  fi
  su -c "sh '$HOME/root-install-selinux.sh' '$(id -u)' '$(id -g)'"
  [ "$(node -p 'require(process.argv[1]).version' "$DSH_DIR/package.json")" = "$DSH_VERSION" ]

  # Root deployment manages only the ordinary global npm tree. The repair helper
  # rejects symlinked/pnpm install roots rather than relabelling their targets.
  DSH_REAL="$DSH_DIR"
  SCOPE_DIR="$DSH_DIR/node_modules/@deepseek-ai"
  MODROOT="$DSH_DIR/node_modules"
  [ -d "$SCOPE_DIR" ] || { echo "[error] unsupported DSH dependency layout: $SCOPE_DIR"; exit 1; }
  echo "SCOPE_DIR=$SCOPE_DIR"

  echo "[step] sharp WASM matching the installed sharp package"
  SHARP_VERSION=$(node -p 'require(process.argv[1]).version' "$MODROOT/sharp/package.json")
  WASM_VERSION=""
  if [ -f "$MODROOT/@img/sharp-wasm32/package.json" ]; then
    WASM_VERSION=$(node -p 'require(process.argv[1]).version' "$MODROOT/@img/sharp-wasm32/package.json")
  fi
  if [ "$WASM_VERSION" != "$SHARP_VERSION" ]; then
    (cd "$DSH_REAL" && npm install --ignore-scripts --omit=dev --registry "$DSH_NPM_REGISTRY" --no-save --package-lock=false "@img/sharp-wasm32@$SHARP_VERSION")
  else
    echo "[resume] sharp-wasm32 $WASM_VERSION already installed"
  fi
  su -c "sh '$HOME/root-install-selinux.sh' '$(id -u)' '$(id -g)'"
  # Do real image work: resolving the package alone does not prove WASM loads.
  (cd "$DSH_REAL" && node --input-type=module -e '
    import { createRequire } from "node:module";
    const require = createRequire(process.cwd() + "/package.json");
    const sharp = require("sharp");
    await sharp({create:{width:1,height:1,channels:4,background:"#fff"}}).png().toBuffer();
    console.log("[ok] sharp image encode");
  ')
  echo "[step] apply all required version-aware Android patches"
  node "$HOME/apply-android-patches.mjs" "$DSH_DIR"

  echo "[step] check llm-deepseek model catalog declares image input"
  # A user-level `llm-deepseek.models` list REPLACES the shipped catalog, and the
  # schema defaults inputModalities to ["text"] — so a model that really does accept
  # images (e.g. deepseek-flash) is refused with "Model ... does not support image
  # input." Adding `inputModalities: [text, image]` to that entry fixes it.
  if [ -f "$HOME/.dsh/settings.yaml" ] && grep -q 'llm-deepseek' "$HOME/.dsh/settings.yaml"; then
    if grep -q 'inputModalities' "$HOME/.dsh/settings.yaml"; then
      echo "[ok] settings.yaml 已声明 inputModalities"
    else
      echo "[warn] ~/.dsh/settings.yaml 里 llm-deepseek.models 没写 inputModalities："
      echo "       这些模型会被当成纯文本，添加图片会被拒绝。若要支持图片，在该模型条目下加一行"
      echo "         inputModalities: [text, image]"
    fi
  fi

  if [ -d "$HOME/.dsh/.agent-presets" ]; then
    cp -a "$HOME/.dsh/.agent-presets" "$HOME/.dsh/.agent-presets.backup-$(date +%Y%m%d-%H%M%S)-$$"
    node "$HOME/patch-dsh-presets.mjs" "$HOME/.dsh/.agent-presets"
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
  PROFILE_PATCH="$HOME/.dsh/profiles/web/cordis.patch.yml"
  node "$HOME/configure-android-profile.mjs" "$DSH_DIR" "$PROFILE_PATCH" "$HOME/cordis.patch.yml"

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
  if [ -n "${DEEPSEEK_API_KEY:-}" ] && printf '%s' "$DEEPSEEK_API_KEY" | grep -Eq '^sk-[A-Za-z0-9_-]+$'; then
    printf '%s' "$DEEPSEEK_API_KEY" > "$HOME/.dsh-api-key"
    chmod 600 "$HOME/.dsh-api-key"
    echo "[ok] API key saved to ~/.dsh-api-key (chmod 600)"
  elif [ -n "${DEEPSEEK_API_KEY:-}" ]; then
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

  echo "[step] record launcher alias without replacing shell configuration"
  ALIAS_LINE="alias dsh='node --expose-internals \$(npm root -g)/@deepseek-ai/dsh/lib/bin.js'"
  if ! grep -Fqx "$ALIAS_LINE" "$HOME/.bashrc" 2>/dev/null; then
    [ ! -f "$HOME/.bashrc" ] || cp -p "$HOME/.bashrc" "$HOME/.bashrc.backup-$(date +%Y%m%d-%H%M%S)-$$"
    printf '\n%s\n' "$ALIAS_LINE" >> "$HOME/.bashrc"
  fi
  su -c "sh '$HOME/root-install-selinux.sh' '$(id -u)' '$(id -g)'"
  echo "[step] verify every required Android patch and plugin"
  node "$HOME/verify-patched-tree.mjs" "$HOME/.dsh" "$DSH_DIR"
  node "$HOME/verify-android-runtime.mjs" "$DSH_DIR"
  # Check the CLI boots without a network request or disclosing credentials.
  node --expose-internals "$DSH_DIR/lib/bin.js" --version

  echo "[step] verify one real turn over the live web API"
  # Advisory only: the wizard may not have started dsh web yet. A green VERIFY_OK is
  # the only proof that the whole chain (patches + presets + mnemon) actually works;
  # run it by hand any time with: node ~/verify-turn.mjs 3080 ~
  if [ -f "$HOME/verify-turn.mjs" ] && curl -sf -o /dev/null --max-time 3 http://127.0.0.1:3080/ 2>/dev/null; then
    timeout -s KILL 180 node "$HOME/verify-turn.mjs" 3080 "$HOME"
  else
    echo "[skip] dsh web 未运行；部署完可在 App 里执行 node ~/verify-turn.mjs 3080 ~ 自检"
  fi

  touch "$HOME/.dsh-setup-ok"
  echo "SETUP OK"
}
