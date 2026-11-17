"""仅在显式启用时，使用随机测试记录验证系统凭据往返，随后清理。"""
import os
import subprocess
import sys
import unittest
import uuid

import zentao_read


@unittest.skipUnless(
    os.environ.get('ZENTAO_TEST_SYSTEM_CREDENTIALS') == '1'
    and sys.platform in ('darwin', 'win32'),
    '系统凭据集成测试需要显式启用，且仅用于 macOS/Windows',
)
class NativeCredentialsTests(unittest.TestCase):
    def test_temporary_system_record_round_trip(self):
        service = 'zentao-personal-test-' + uuid.uuid4().hex
        account = 'ephemeral-fixture'
        password = '测试-quote\'"-backslash\\-space -only-fixture-' + uuid.uuid4().hex
        config = {'keychain_service': service, 'account': account}
        try:
            self.assertTrue(zentao_read.save_password(config, password))
            self.assertEqual(zentao_read.read_password(config), password)
        finally:
            if sys.platform == 'darwin':
                subprocess.run(
                    ['/usr/bin/security', 'delete-generic-password', '-s', service, '-a', account],
                    capture_output=True, timeout=30,
                )
            else:
                import keyring
                try:
                    keyring.delete_password(service, account)
                except keyring.errors.PasswordDeleteError:
                    pass


if __name__ == '__main__':
    unittest.main()
