"""Exercise production installer version/profile decisions without a phone."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

BASH = shutil.which('bash')
if os.name == 'nt' and Path('C:/Program Files/Git/bin/bash.exe').exists():
    BASH = 'C:/Program Files/Git/bin/bash.exe'
SOURCE = (Path(__file__).resolve().parents[1] / 'scripts/setup-root.sh').read_text(encoding='utf-8')

@unittest.skipUnless(BASH, 'bash required')
class InstallerDecisions(unittest.TestCase):
    def run_script(self, code, root, **variables):
        def unix(path):
            value = str(path).replace('\\', '/')
            return '/' + value[0].lower() + value[2:] if len(value) > 1 and value[1] == ':' else value
        prelude = 'set -eu\nHOME="' + unix(root) + '"\nDSH_DIR="$HOME/package"\n'
        env = dict(os.environ)
        env.pop('DSH_VERSION', None)
        env.update(variables)
        return subprocess.run([BASH, '-c', prelude + code], env=env, capture_output=True, text=True)

    def test_version_selection_and_supported_range(self):
        block = SOURCE[SOURCE.index('  INSTALLED=""'):SOURCE.index('  export npm_config_cache')]
        for installed, explicit, expected, success in [
            ('0.2.0-rc.2', None, '0.2.0-rc.2', True),
            ('0.2.0-rc.1', None, '0.2.0-rc.1', True),
            (None, None, '0.2.0-rc.2', True),
            ('0.2.0-rc.2', '0.2.0-rc.1', '0.2.0-rc.1', True),
            ('0.2.0', None, '', False),
            ('0.1.5-rc.2', None, '', False),
        ]:
            with self.subTest(installed=installed, explicit=explicit), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / 'package').mkdir()
                if installed:
                    (root / 'package/package.json').write_text(json.dumps({'version': installed}))
                kwargs = {'DSH_VERSION': explicit} if explicit else {}
                result = self.run_script(block + '\nprintf "SELECTED=%s" "$DSH_VERSION"\n', root, **kwargs)
                self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
                if success:
                    self.assertIn('SELECTED=' + expected, result.stdout)

    def test_process_domain_and_mcs_gate(self):
        start = SOURCE.index('PROCESS_CONTEXT=')
        block = SOURCE[start:SOURCE.index('[ -f "$HOME/root-install-selinux.sh" ]', start)]
        for context, accepted in [
            ('u:r:untrusted_app_27:s0:c123,c456', True),
            ('u:r:runas_app:s0:c123,c456', True),
            ('u:r:su:s0', False),
            ('u:r:shell:s0', False),
            ('u:r:untrusted_app_27:s0:c111,c222', False),
        ]:
            with self.subTest(context=context), tempfile.TemporaryDirectory() as tmp:
                mocks = 'cat() { printf "%s" "$TEST_CONTEXT"; }; stat() { printf "%s" "u:object_r:app_data_file:s0:c123,c456"; };\n'
                result = self.run_script(mocks + block, Path(tmp), TEST_CONTEXT=context)
                self.assertEqual(result.returncode == 0, accepted, result.stdout + result.stderr)

    def test_explicit_reinstall_preserves_backup_and_restores_after_failure(self):
        start = SOURCE.index('  case "${DSH_REINSTALL:-0}"')
        block = SOURCE[start:SOURCE.index('  su -c ', start)]
        for fails in (False, True):
            with self.subTest(fails=fails), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / 'package').mkdir()
                (root / 'package/original').write_text('keep old package')
                npm_mock = 'npm() { mkdir -p "$DSH_DIR"; printf partial > "$DSH_DIR/new-package"; return ' + ('42' if fails else '0') + '; };\n'
                code = 'INSTALLED=0.2.0-rc.2; DSH_VERSION=0.2.0-rc.2; DSH_NPM_REGISTRY=https://registry.npmjs.org; LOG=test.log\n' + npm_mock + block
                result = self.run_script(code, root, DSH_REINSTALL='1')
                self.assertEqual(result.returncode == 0, not fails, result.stdout + result.stderr)
                if fails:
                    self.assertTrue((root / 'package/original').exists())
                    self.assertFalse((root / 'package/new-package').exists())
                    self.assertTrue(list((root / '.dsh-install-backups').glob('*.failed-install/new-package')))
                else:
                    self.assertTrue((root / 'package/new-package').exists())
                    self.assertTrue(list((root / '.dsh-install-backups').glob('*/original')))

    def test_repair_precedes_metadata_and_checks_precede_success_receipt(self):
        repair = SOURCE.index("  su -c \"sh '$HOME/root-install-selinux.sh'")
        metadata = SOURCE.index('INSTALLED=$(node')
        self.assertLess(repair, metadata)
        self.assertLess(SOURCE.index('flock --exclusive --nonblock 9'), repair)
        self.assertLess(SOURCE.index('DSH web is running'), repair)
        self.assertLess(SOURCE.index('node "$HOME/verify-android-runtime.mjs"'), SOURCE.index('touch "$HOME/.dsh-setup-ok"'))
        self.assertNotIn('npm config set registry', SOURCE)

if __name__ == '__main__':
    unittest.main()
