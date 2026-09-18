#!/usr/bin/env bash
# preflight.sh — repo-side checks for the failure classes that only ever showed up on
# the device. Runs in CI before the APKs are built, and locally before a deploy.
#
# Every check here exists because the class already cost us a debugging session:
#
#   syntax        patch-dsh-client-modules.mjs shipped with a comment swallowing a
#                 `const` declaration -> SyntaxError at run time, reported on the
#                 device as "client-modules not present (pre-0.1.5 build?)".
#   loud targets  patch-dsh-link.mjs printed "skip (missing)" for every target and
#                 exited 0 -> the one-tap deploy "succeeded" with every gate open.
#   layout        setup-root.sh hard-coded $DSH_DIR/node_modules/@deepseek-ai/<pkg>,
#                 which does not exist when the install is a symlink into a
#                 hand-built tree -> deploy aborted with ENOENT mid-way.
#   versioning    versionCode/Name drift between build-apk.sh, the workflow and the
#                 PowerShell builder ships an APK that cannot update in place.
#   payload       a patcher missing from the payload is a gate that never closes on a
#                 fresh install (v0.2.6 shipped without the flock patch).
#
# Usage: bash tools/preflight.sh          (exit 0 = ok)
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail=0
note() { printf '%s %s\n' "$1" "$2"; }

# --- 1. every shipped script parses -----------------------------------------
for f in scripts/*.mjs tools/*.mjs tools/phone-probes/*.mjs; do
  [ -f "$f" ] || continue
  node --check "$f" >/dev/null 2>&1 || { note FAIL "syntax: $f"; fail=1; }
done
for f in scripts/*.sh tools/*.sh tools/phone-probes/*.sh; do
  [ -f "$f" ] || continue
  bash -n "$f" 2>/dev/null || { note FAIL "syntax: $f"; fail=1; }
done
[ "$fail" = 0 ] && note ok "all scripts parse"

# --- 2. patchers must fail loudly when their target is absent ---------------
for f in scripts/patch-dsh*.mjs; do
  [ -f "$f" ] || continue
  case "$f" in
    *presets*) continue ;;   # takes a directory, not a package file
  esac
  if node "$f" /nonexistent-preflight-target >/dev/null 2>&1; then
    note FAIL "silent no-op: $f exited 0 on a missing target"
    fail=1
  fi
done
[ "$fail" = 0 ] && note ok "every patcher fails loudly on a missing target"

# --- 3. deploy scripts must not assume the nested npm layout ---------------
for f in scripts/setup-root.sh scripts/setup-shizuku.sh scripts/upgrade-to-015.sh; do
  [ -f "$f" ] || continue
  if grep -q '\$DSH_DIR/node_modules/@deepseek-ai/' "$f"; then
    note FAIL "layout: $f hard-codes \$DSH_DIR/node_modules/@deepseek-ai (breaks symlinked installs)"
    fail=1
  fi
done
[ "$fail" = 0 ] && note ok "deploy scripts resolve the dependency scope at run time"

# --- 4. version consistency across the three builders ----------------------
v_name=$(node tools/preflight-facts.mjs name)
v_code=$(node tools/preflight-facts.mjs code)
grep -q "VERSION_NAME: '$v_name'" .github/workflows/android.yml \
  || { note FAIL "version: workflow VERSION_NAME != $v_name"; fail=1; }
grep -q "VERSION_CODE: '$v_code'" .github/workflows/android.yml \
  || { note FAIL "version: workflow VERSION_CODE != $v_code"; fail=1; }
grep -q -- "--version-name $v_name" app/root/build-apk.ps1 \
  || { note FAIL "version: app/root/build-apk.ps1 != $v_name"; fail=1; }
[ "$fail" = 0 ] && note ok "version $v_name/$v_code consistent in build-apk.sh, workflow, ps1"

# --- 5. every payload entry exists, and the gate verifier ships -------------
payload=$(node tools/preflight-facts.mjs payload)
[ -n "$payload" ] || { note FAIL "payload: could not read PAYLOAD lists from tools/build-apk.sh"; fail=1; }
for f in $payload; do
  [ -f "scripts/$f" ] || { note FAIL "payload: scripts/$f is listed but missing"; fail=1; }
done
for f in $payload; do
  case "$f" in
    setup-*.sh)
      grep -q 'verify-patched-tree.mjs' "scripts/$f" \
        || { note FAIL "payload: scripts/$f never runs verify-patched-tree.mjs"; fail=1; }
      ;;
  esac
done
echo "$payload" | grep -q 'verify-patched-tree.mjs' \
  || { note FAIL "payload: verify-patched-tree.mjs is not shipped (no post-deploy gate check)"; fail=1; }
[ "$fail" = 0 ] && note ok "payload complete ($(echo "$payload" | wc -l | tr -d ' ') files)"

# --- 1b. commit subject hygiene ---------------------------------------------
# GitHub prints each file's newest commit subject next to the filename, so an
# overlong subject becomes the repo's front page. Details belong in the body.
subject=$(git log -1 --format=%s 2>/dev/null || true)
if [ -n "$subject" ]; then
  len=$(node -e 'process.stdout.write(String(process.argv[1].length))' "$subject")
  if [ "$len" -gt 72 ]; then
    note FAIL "commit: subject is $len chars (limit 72): $subject"
    fail=1
  else
    note ok "commit subject is $len chars (limit 72)"
  fi
fi

# --- 6. no script may use the attribute-clobbering copy shape ----------------
# `cp -a src/. dst/` applies the SOURCE directory's ownership/mode to dst. Staging a
# payload from /data/local/tmp (shell:shell) or a root-owned dir into the Termux home
# that way left ~ owned by another uid with mode 775, so the Termux uid could not
# create anything inside its own home (2026-09-17, "cannot create ...: EACCES mkdir").
copies=$(grep -nE 'cp +-[a-zA-Z]*[ar][a-zA-Z]* +[^ ]*/\. ' scripts/*.sh tools/*.sh 2>/dev/null | grep -vE '^[^:]+:[0-9]+: *#' || true)
if [ -n "$copies" ]; then
  printf '%s\n' "$copies"
  note FAIL "copy: the line(s) above use 'cp -a/-r <src>/. <dst>/' — restore dst ownership/mode afterwards"
  fail=1
else
  note ok "no attribute-clobbering payload copies in shell scripts"
fi

# --- 6. docs the gates reference must exist --------------------------------
[ -f docs/ANDROID-GATES.md ] || { note FAIL "docs/ANDROID-GATES.md is missing"; fail=1; }
[ "$fail" = 0 ] && note ok "gate documentation present"

echo
[ "$fail" = 0 ] && echo "PREFLIGHT_OK" || echo "PREFLIGHT_FAIL"
exit "$fail"
