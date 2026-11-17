import builtins
from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import zentao_read
from zentao_read import Client, ZenTaoError, decode_data

CONFIG = {'base_url': 'https://zentao.example.test/zentao/', 'account': 'tester'}
FULL_CONFIG = {
    **CONFIG,
    'keychain_service': 'zentao-personal:zentao.example.test/zentao',
}


def response(bugs, total, page=1):
    return json.dumps({'status': 'success', 'data': json.dumps({
        'type': 'assignedTo', 'bugs': bugs,
        'pager': {'pageID': page, 'recPerPage': 100, 'recTotal': total},
    })})


class ReadOnlyTests(unittest.TestCase):
    def test_decodes_legacy_nested_json(self):
        self.assertEqual(decode_data(response([], 0))['bugs'], [])

    def test_rejects_login_page_or_business_error(self):
        for raw in ('<html>请登录</html>', '{}', '[]', '{"status":"fail","data":{}}'):
            with self.subTest(raw=raw), self.assertRaises(ZenTaoError):
                decode_data(raw)

    def test_reads_all_pages_and_handles_keyed_bugs(self):
        client = Client(CONFIG)
        with patch.object(client, 'request', side_effect=[
            response({'1': {'id': 1}}, 2), response([{'id': 2}], 2, page=2),
        ]) as request:
            result = client.assigned()
        self.assertEqual([bug['id'] for bug in result['bugs']], [1, 2])
        self.assertEqual(result['total'], 2)
        self.assertTrue(request.call_args_list[1].args[0].endswith('-100-2.json'))

    def test_rejects_duplicate_or_incomplete_pages(self):
        for second in ([{'id': 1}], []):
            client = Client(CONFIG)
            with self.subTest(second=second), patch.object(client, 'request', side_effect=[
                response([{'id': 1}], 2), response(second, 2, page=2),
            ]), self.assertRaises(ZenTaoError):
                client.assigned()

    def test_rejects_ignored_pagination(self):
        client = Client(CONFIG)
        raw = json.dumps({'status': 'success', 'data': {
            'type': 'assignedTo', 'bugs': [],
            'pager': {'pageID': 1, 'recPerPage': 20, 'recTotal': 0},
        }})
        with patch.object(client, 'request', return_value=raw), self.assertRaises(ZenTaoError):
            client.assigned()

    def test_login_uses_challenge_instead_of_plain_password(self):
        client = Client(CONFIG)
        with patch.object(client, 'request', side_effect=[
            '<html></html>', '1234', '{"result":"success"}',
        ]) as request:
            client.login('fixture-password')
        path, fields = request.call_args.args
        self.assertEqual(path, 'user-login.html')
        self.assertNotEqual(fields['password'], 'fixture-password')
        self.assertEqual(len(fields['password']), 32)
        self.assertEqual(fields['verifyRand'], '1234')

    def test_login_referer_uses_configured_site_path(self):
        client = Client({
            'base_url': 'https://example.test/custom/zentao/',
            'account': 'tester',
        })
        with patch.object(client, 'request', side_effect=[
            '<html></html>', '1234', '{"result":"success"}',
        ]) as request:
            client.login('fixture-password')
        fields = request.call_args.args[1]
        self.assertEqual(fields['referer'], '/custom/zentao/my-work-bug.html')

    def test_captcha_stops_before_login_submission(self):
        client = Client(CONFIG)
        with patch.object(client, 'request', return_value='<input name="captcha">') as request:
            with self.assertRaises(ZenTaoError):
                client.login('fixture-password')
        self.assertEqual(request.call_count, 1)

    def test_auth_error_does_not_expose_server_credentials(self):
        client = Client(CONFIG)
        with patch.object(client, 'request', side_effect=[
            '<html></html>', '1234', '{"result":"fail","message":"sensitive-server-data"}',
        ]):
            with self.assertRaises(ZenTaoError) as error:
                client.login('fixture-password')
        self.assertNotIn('sensitive-server-data', str(error.exception))
        self.assertNotIn('fixture-password', str(error.exception))

    def test_bug_details_include_only_relevant_fields(self):
        client = Client(CONFIG)
        raw = json.dumps({'status': 'success', 'data': {
            'bug': {'id': 42, 'title': '示例'}, 'actions': [],
            'unrelated': 'not exported',
        }})
        with patch.object(client, 'request', return_value=raw) as request:
            result = client.bug(42)
        self.assertEqual(set(result), {'bug', 'actions'})
        self.assertEqual(request.call_args.args[0], 'bug-view-42.json')


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.config_path = Path(self.temporary_directory.name) / 'config.json'

    def run_configure(self, answers):
        with patch.object(zentao_read, 'CONFIG_PATH', self.config_path), \
                patch('builtins.input', side_effect=answers), \
                patch.object(zentao_read.getpass, 'getpass', return_value='fixture-password'), \
                patch.object(zentao_read.Client, 'login') as login, \
                patch.object(zentao_read, 'save_password', return_value=True) as save, \
                redirect_stdout(io.StringIO()):
            result = zentao_read.main(['configure'])
        self.assertEqual(result, 0)
        login.assert_called_once_with('fixture-password')
        save.assert_called_once()
        return save.call_args.args[0]

    def test_configure_creates_new_config_without_plaintext_password(self):
        configured = self.run_configure([
            'https://zentao.example.test/zentao/', 'new-user',
        ])
        raw = self.config_path.read_text(encoding='utf-8')
        saved = json.loads(raw)
        self.assertEqual(saved, configured)
        self.assertEqual(saved['account'], 'new-user')
        self.assertEqual(saved['base_url'], 'https://zentao.example.test/zentao/')
        self.assertIn('keychain_service', saved)
        self.assertNotIn('fixture-password', raw)
        if os.name != 'nt':
            self.assertEqual(stat.S_IMODE(self.config_path.stat().st_mode), 0o600)

    def test_configure_keeps_existing_site_account_and_keychain_service(self):
        original = {
            **FULL_CONFIG,
            'keychain_service': 'existing-private-service-name',
        }
        zentao_read.write_config(original, self.config_path)
        configured = self.run_configure(['', ''])
        self.assertEqual(configured, original)
        self.assertEqual(json.loads(self.config_path.read_text()), original)

    def test_invalid_existing_config_is_not_overwritten(self):
        raw = '{"base_url": "https://example.test", "account": ""}'
        self.config_path.write_text(raw, encoding='utf-8')
        with patch.object(zentao_read, 'CONFIG_PATH', self.config_path), \
                patch('builtins.input') as input_mock, \
                redirect_stderr(io.StringIO()):
            result = zentao_read.main(['configure'])
        self.assertEqual(result, 1)
        input_mock.assert_not_called()
        self.assertEqual(self.config_path.read_text(encoding='utf-8'), raw)

    def test_missing_backend_can_use_password_for_one_query(self):
        with patch.object(zentao_read, 'read_password', return_value=None), \
                patch.object(sys.stdin, 'isatty', return_value=True), \
                patch.object(zentao_read.getpass, 'getpass', return_value='fixture-password'):
            password = zentao_read.password_for_query(FULL_CONFIG)
        self.assertEqual(password, 'fixture-password')

    def test_non_interactive_query_requires_saved_credentials(self):
        with patch.object(zentao_read, 'read_password', return_value=None), \
                patch.object(sys.stdin, 'isatty', return_value=False), \
                self.assertRaises(ZenTaoError):
            zentao_read.password_for_query(FULL_CONFIG)

    def test_non_macos_uses_keyring_when_available(self):
        credentials = {}
        fake_keyring = types.SimpleNamespace(
            get_keyring=lambda: types.SimpleNamespace(priority=5),
            set_password=lambda service, account, password: credentials.update({
                (service, account): password,
            }),
            get_password=lambda service, account: credentials.get((service, account)),
        )
        with patch.object(zentao_read.sys, 'platform', 'linux'), \
                patch.dict(sys.modules, {'keyring': fake_keyring}):
            self.assertTrue(zentao_read.save_password(FULL_CONFIG, 'fixture-password'))
            self.assertEqual(zentao_read.read_password(FULL_CONFIG), 'fixture-password')

    def test_non_macos_without_keyring_supports_unsaved_mode(self):
        original_import = builtins.__import__

        def import_without_keyring(name, *args, **kwargs):
            if name == 'keyring':
                raise ImportError('fixture: keyring unavailable')
            return original_import(name, *args, **kwargs)

        with patch.object(zentao_read.sys, 'platform', 'linux'), \
                patch('builtins.__import__', side_effect=import_without_keyring):
            self.assertIsNone(zentao_read.read_password(FULL_CONFIG))
            self.assertFalse(zentao_read.save_password(FULL_CONFIG, 'fixture-password'))

    def test_macos_password_is_not_passed_as_process_argument(self):
        completed = types.SimpleNamespace(returncode=0, stdout='', stderr='password: "fixture-password"\n')
        with patch.object(zentao_read.sys, 'platform', 'darwin'), \
                patch.object(zentao_read.subprocess, 'run', return_value=completed) as run:
            self.assertTrue(zentao_read.save_password(FULL_CONFIG, 'fixture-password'))
        command = run.call_args_list[0].args[0]
        self.assertNotIn('fixture-password', command)
        self.assertIn('fixture-password', run.call_args_list[0].kwargs['input'])

    def test_macos_decodes_unicode_hex_without_confusing_ascii_hex_passwords(self):
        for password, encoded in [
            ('测试密码', '0x' + '测试密码'.encode().hex() + ' '),
            ('deadbeef1234', '"deadbeef1234"'),
            ('a"b c', '"a"b c"'),
        ]:
            result = types.SimpleNamespace(returncode=0, stdout='', stderr='password: ' + encoded + '\n')
            with self.subTest(password=password), patch.object(zentao_read.sys, 'platform', 'darwin'), \
                    patch.object(zentao_read.subprocess, 'run', return_value=result):
                self.assertEqual(zentao_read.read_password(FULL_CONFIG), password)

    def test_no_keyring_backend_can_still_use_interactive_mode(self):
        fake_keyring = types.SimpleNamespace(get_keyring=lambda: types.SimpleNamespace(priority=0))
        with patch.object(zentao_read.sys, 'platform', 'win32'), \
                patch.dict(sys.modules, {'keyring': fake_keyring}):
            self.assertIsNone(zentao_read.read_password(FULL_CONFIG))
            self.assertFalse(zentao_read.save_password(FULL_CONFIG, 'fixture-password'))

    def test_unicode_password_roundtrip_uses_system_credentials(self):
        credentials = {}
        fake_keyring = types.SimpleNamespace(
            get_keyring=lambda: types.SimpleNamespace(priority=5),
            set_password=lambda service, account, password: credentials.update({(service, account): password}),
            get_password=lambda service, account: credentials.get((service, account)),
        )
        with patch.object(zentao_read.sys, 'platform', 'win32'), \
                patch.dict(sys.modules, {'keyring': fake_keyring}):
            self.assertTrue(zentao_read.save_password(FULL_CONFIG, '示例密码-only-fixture'))
            self.assertEqual(zentao_read.read_password(FULL_CONFIG), '示例密码-only-fixture')

    def test_doctor_never_reads_credentials_or_connects(self):
        with patch.object(zentao_read, 'CONFIG_PATH', self.config_path), \
                patch.object(zentao_read, 'read_password') as password, \
                patch.object(Client, 'login') as login, redirect_stdout(io.StringIO()):
            self.assertEqual(zentao_read.main(['doctor']), 0)
        password.assert_not_called()
        login.assert_not_called()


if __name__ == '__main__':
    unittest.main()
