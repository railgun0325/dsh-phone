"""Mock Android ownership/MCS metadata; never relabel the host filesystem."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

BASH = shutil.which('bash')
if os.name == 'nt' and Path('C:/Program Files/Git/bin/bash.exe').exists():
    BASH = 'C:/Program Files/Git/bin/bash.exe'
SOURCE = Path(__file__).resolve().parents[1] / 'scripts/root-install-selinux.sh'

@unittest.skipUnless(BASH, 'bash required')
class ScopedRepairTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.base = self.root / 'app/files'
        self.home = self.base / 'home'
        self.prefix = self.base / 'usr'
        self.tree = self.prefix / 'lib/node_modules/@deepseek-ai/dsh'
        for d in (self.home, self.tree, self.prefix / 'bin', self.root / 'mock', self.root / 'state'):
            d.mkdir(parents=True, exist_ok=True)
        (self.tree / 'categoryless').write_text('payload')
        self.env = dict(os.environ, REPAIR_TEST_STATE=self.unix(self.root / 'state'))
        self.write_mock('id', 'echo 0\n')
        self.write_mock('stat', '''entry=$3
case "$2" in
  %u) echo 10001;;
  %u:%g) echo 10001:10001;;
  %C)
    case "$entry" in
      *foreign*) echo u:object_r:system_file:s0;;
      *categoryless*)
        if [ -f "$REPAIR_TEST_STATE/relabelled" ]; then echo u:object_r:app_data_file:s0:c123,c456; else echo u:object_r:app_data_file:s0; fi;;
      *) echo u:object_r:app_data_file:s0:c123,c456;;
    esac;;
  *) exit 2;;
esac
''')
        self.write_mock('chcon', '''[ "$1" = -h ] || exit 9
printf '%s\\n' "$3" >> "$REPAIR_TEST_STATE/changes"
touch "$REPAIR_TEST_STATE/relabelled"
''')
        self.write_mock('chown', 'exit 8\n')  # owner is already correct
        text = SOURCE.read_text(encoding='utf-8')
        text = text.replace('PATH=/data/data/com.termux/files/usr/bin:/system/bin:/system/xbin',
                            'PATH="' + self.unix(self.root / 'mock') + ':$PATH"')
        text = text.replace('/data/data/com.termux', self.unix(self.root / 'app'))
        self.script = self.root / 'repair.sh'
        self.script.write_text(text, encoding='utf-8', newline='\n')

    def tearDown(self):
        self.tmp.cleanup()

    @staticmethod
    def unix(path):
        value = str(path).replace('\\', '/')
        if len(value) > 1 and value[1] == ':':
            return '/' + value[0].lower() + value[2:]
        return value

    def write_mock(self, name, body):
        target = self.root / 'mock' / name
        target.write_text('#!/bin/sh\n' + body, encoding='utf-8', newline='\n')
        target.chmod(0o755)

    def run_repair(self, *args):
        return subprocess.run([BASH, self.unix(self.script), '10001', '10001', *args], env=self.env,
                              capture_output=True, text=True)

    def test_categoryless_entry_repaired_and_second_run_idempotent(self):
        first = self.run_repair()
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        changes = (self.root / 'state/changes').read_text()
        self.assertIn('/categoryless', changes)
        second = self.run_repair()
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        self.assertEqual((self.root / 'state/changes').read_text(), changes)

    def test_bootstrap_repairs_only_installer_paths(self):
        logs = self.home / '.dsh-install-logs'
        logs.mkdir()
        (logs / 'categoryless').write_text('old installer log')
        result = self.run_repair('bootstrap')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        changes = (self.root / 'state/changes').read_text()
        self.assertIn('.dsh-install-logs/categoryless', changes)
        self.assertNotIn('/node_modules/', changes)

    def test_unrelated_context_rejected_before_any_mutation(self):
        (self.tree / 'foreign').write_text('unrelated label')
        result = self.run_repair()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('refusing unrelated SELinux', result.stdout)
        self.assertFalse((self.root / 'state/changes').exists())

    @unittest.skipIf(os.name == 'nt', 'Windows developer symlink privilege unavailable')
    def test_managed_root_symlink_rejected(self):
        shutil.rmtree(self.tree)
        self.tree.symlink_to(self.home, target_is_directory=True)
        result = self.run_repair()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('symlink managed root refused', result.stdout)

if __name__ == '__main__':
    unittest.main()
