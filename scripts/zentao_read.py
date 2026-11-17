#!/usr/bin/env python3
"""通过系统凭据库认证，只读查询个人禅道旧版接口（已在 18.7 验证）。"""
import argparse
import getpass
import hashlib
import hmac
import http.cookiejar
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener

CONFIG_PATH = Path.home() / '.config/zentao-personal/config.json'
CONFIG_KEYS = ('base_url', 'account', 'keychain_service')


class ZenTaoError(Exception):
    pass


def validate_config(config):
    try:
        if not isinstance(config, dict):
            raise ValueError()
        normalized = {}
        for key in CONFIG_KEYS:
            if not isinstance(config[key], str) or not config[key].strip():
                raise ValueError()
            normalized[key] = config[key].strip()
        url = urlsplit(normalized['base_url'])
        if (url.scheme not in ('http', 'https') or not url.hostname
                or url.username or url.password or url.query or url.fragment):
            raise ValueError()
        normalized['base_url'] = normalized['base_url'].rstrip('/') + '/'
        return normalized
    except (ValueError, KeyError, TypeError):
        raise ZenTaoError('配置必须包含有效的 base_url、account 和 keychain_service；地址不得包含账号、密码、查询参数或锚点。') from None


def load_config(path=None, missing_ok=False):
    path = path or CONFIG_PATH
    try:
        raw = path.read_text(encoding='utf-8')
    except FileNotFoundError:
        if missing_ok:
            return None
        raise ZenTaoError('尚未配置禅道；请先运行本脚本的 configure 命令。') from None
    except OSError:
        raise ZenTaoError('无法读取禅道配置，请检查文件权限。') from None
    try:
        return validate_config(json.loads(raw))
    except (ValueError, TypeError):
        raise ZenTaoError('禅道配置格式错误；请修正配置或备份后重新运行 configure。') from None


def write_config(config, path=None):
    path = path or CONFIG_PATH
    config = validate_config(config)
    temporary_path = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
                mode='w', encoding='utf-8', dir=path.parent,
                prefix='.config-', suffix='.json', delete=False) as file:
            temporary_path = Path(file.name)
            os.chmod(temporary_path, 0o600)
            json.dump(config, file, ensure_ascii=False, indent=2)
            file.write('\n')
        os.replace(temporary_path, path)
        os.chmod(path, 0o600)
    except OSError:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise ZenTaoError('无法保存禅道配置，请检查配置目录权限。') from None


def default_keychain_service(base_url):
    url = urlsplit(base_url)
    return 'zentao-personal:' + url.netloc + url.path.rstrip('/')


def read_password(config):
    if sys.platform == 'darwin':
        result = subprocess.run(
            ['/usr/bin/security', 'find-generic-password', '-s', config['keychain_service'],
             '-a', config['account'], '-w'],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode or not result.stdout.rstrip('\r\n'):
            raise ZenTaoError('系统钥匙串中没有可用凭据或访问被拒绝；请运行本脚本的 configure 命令。')
        return result.stdout.rstrip('\r\n')

    try:
        import keyring
    except ImportError:
        return None
    try:
        if keyring.get_keyring().priority <= 0:
            return None
        return keyring.get_password(config['keychain_service'], config['account']) or None
    except Exception:
        raise ZenTaoError('系统凭据库访问失败；请检查凭据库或重新运行 configure。') from None


def save_password(config, password):
    if sys.platform == 'darwin':
        # 使用 stdin 传给 security 交互模式，密码不进入进程参数或磁盘文件。
        command = shlex.join([
            'add-generic-password', '-U', '-a', config['account'],
            '-s', config['keychain_service'], '-w', password,
        ])
        subprocess.run(
            ['/usr/bin/security', '-i'], input=command + '\n',
            capture_output=True, text=True, timeout=30,
        )
        if not hmac.compare_digest(read_password(config).encode(), password.encode()):
            raise ZenTaoError('钥匙串写入核实失败。')
        return True

    try:
        import keyring
    except ImportError:
        return False
    try:
        if keyring.get_keyring().priority <= 0:
            return False
        keyring.set_password(config['keychain_service'], config['account'], password)
        saved = keyring.get_password(config['keychain_service'], config['account'])
    except Exception:
        raise ZenTaoError('系统凭据库写入失败，请检查 keyring 后端和系统授权。') from None
    if saved is None or not hmac.compare_digest(saved.encode(), password.encode()):
        raise ZenTaoError('系统凭据库写入核实失败。')
    return True


def prompt_text(label, default=''):
    suffix = f' [{default}]' if default else ''
    try:
        value = input(f'{label}{suffix}: ').strip()
    except (EOFError, KeyboardInterrupt):
        raise ZenTaoError('已取消配置。') from None
    return value or default


def prompt_password(prompt):
    try:
        password = getpass.getpass(prompt)
    except (EOFError, KeyboardInterrupt):
        raise ZenTaoError('已取消密码输入。') from None
    if not password:
        raise ZenTaoError('密码不能为空。')
    return password


def configure():
    existing = load_config(missing_ok=True)
    defaults = existing or {}
    base_url = prompt_text(
        '禅道地址（例如 https://zentao.example.com/zentao/）',
        defaults.get('base_url', ''),
    )
    account = prompt_text('禅道账号', defaults.get('account', ''))
    if not base_url or not account:
        raise ZenTaoError('禅道地址和账号不能为空。')

    same_site = existing and existing['base_url'] == base_url.rstrip('/') + '/'
    service = (existing['keychain_service'] if same_site
               else default_keychain_service(base_url))
    config = validate_config({
        'base_url': base_url,
        'account': account,
        'keychain_service': service,
    })
    password = prompt_password('禅道密码（输入不可见，不会写入配置文件）：')
    Client(config).login(password)
    stored = save_password(config, password)
    write_config(config)
    if stored:
        print('登录验证成功，配置已保存，凭据已保存至系统凭据库。')
    else:
        print('登录验证成功，配置已保存。未检测到 keyring，后续查询将在终端询问密码；')
        print('如需保存凭据，请先运行 npx zentao-personal credentials，再重新运行 configure。')
    return config


def password_for_query(config):
    password = read_password(config)
    if password is not None:
        return password
    if not sys.stdin.isatty():
        raise ZenTaoError('未找到已保存的凭据，且当前终端不能交互输入；请先运行 configure。')
    return prompt_password('禅道密码（仅本次使用，不保存）：')


def decode_data(raw):
    try:
        payload = json.loads(raw)
        if not isinstance(payload, dict) or payload.get('status') != 'success':
            raise ValueError()
        data = payload['data']
        if isinstance(data, str):
            data = json.loads(data)
        if not isinstance(data, dict):
            raise ValueError()
        return data
    except (ValueError, KeyError, TypeError):
        raise ZenTaoError('禅道未返回有效业务数据，可能登录失效、权限不足或接口发生变化。') from None


class Client:
    def __init__(self, config):
        self.config = config
        self.base = config['base_url'].rstrip('/') + '/'
        self.opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, path, data=None):
        request = Request(
            self.base + path,
            data=urlencode(data).encode() if data is not None else None,
            headers={
                'Referer': self.base + 'user-login.html',
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'User-Agent': 'Codex-ZenTao-ReadOnly/1.0',
            },
        )
        try:
            with self.opener.open(request, timeout=20) as response:
                return response.read().decode('utf-8', 'replace')
        except HTTPError as error:
            raise ZenTaoError('禅道请求失败，HTTP 状态码：' + str(error.code)) from None
        except (URLError, TimeoutError, OSError):
            raise ZenTaoError('禅道网络连接失败或超时。') from None

    def login(self, password):
        page = self.request('user-login.html')
        if re.search(r'name\s*=\s*[\'\"]captcha[\'\"]', page, re.I):
            raise ZenTaoError('禅道要求验证码；请在浏览器中完成登录，本脚本不自动处理验证码。')
        nonce = self.request('user-refreshRandom.html').strip()
        if not nonce.isdigit():
            raise ZenTaoError('无法获取禅道旧版登录随机数。')
        digest = hashlib.md5(password.strip().encode()).hexdigest()
        challenge = hashlib.md5((digest + nonce).encode()).hexdigest()
        raw = self.request('user-login.html', {
            'account': self.config['account'], 'password': challenge,
            'passwordStrength': '2',
            'referer': urlsplit(self.base).path + 'my-work-bug.html',
            'verifyRand': nonce, 'keepLogin': '0', 'captcha': '',
        })
        try:
            result = json.loads(raw)
        except ValueError:
            raise ZenTaoError('禅道未返回有效登录结果，请通过网页检查登录状态。') from None
        if not isinstance(result, dict) or result.get('result') != 'success':
            raise ZenTaoError('禅道认证失败；请检查系统凭据，必要时重新运行 configure。')

    def assigned(self):
        bugs = []
        seen = set()
        page = 1
        while True:
            path = f'my-work-bug-assignedTo-0-id_desc-0-100-{page}.json'
            data = decode_data(self.request(path))
            pager = data.get('pager')
            if (data.get('type') != 'assignedTo' or not isinstance(pager, dict)
                    or int(pager.get('pageID', 0)) != page
                    or int(pager.get('recPerPage', 0)) != 100):
                raise ZenTaoError('分页接口与当前禅道版本不匹配，停止查询以避免漏读。')
            rows = data.get('bugs')
            if isinstance(rows, dict):
                rows = list(rows.values())
            if not isinstance(rows, list):
                raise ZenTaoError('Bug 列表格式异常。')
            for bug in rows:
                if not isinstance(bug, dict) or bug.get('id') is None:
                    raise ZenTaoError('Bug 数据格式异常。')
                bug_id = str(bug['id'])
                if bug_id in seen:
                    raise ZenTaoError('分页返回重复 Bug，请稍后重新读取。')
                seen.add(bug_id)
                bugs.append(bug)
            total = int(pager.get('recTotal', 0))
            if len(bugs) >= total:
                return {'account': self.config['account'], 'total': len(bugs), 'bugs': bugs}
            if not rows:
                raise ZenTaoError('Bug 列表未完整返回，请稍后重试。')
            page += 1
            if page > 100:
                raise ZenTaoError('分页超过 100 页，请缩小查询范围。')

    def bug(self, bug_id):
        data = decode_data(self.request(f'bug-view-{bug_id}.json'))
        if not isinstance(data.get('bug'), dict):
            raise ZenTaoError('Bug 详情不存在或当前账号没有查看权限。')
        return {key: data[key] for key in ('bug', 'actions', 'users') if key in data}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('assigned', help='读取指派给我的 Bug，自动处理分页')
    detail = sub.add_parser('bug', help='读取指定 Bug 详情')
    detail.add_argument('id', type=int)
    sub.add_parser('configure', help='交互配置站点、账号和系统凭据，并核实登录')
    sub.add_parser('doctor', help='检查配置格式，不读取密码、不连接禅道')
    args = parser.parse_args(argv)
    try:
        if args.command == 'doctor':
            config = load_config(missing_ok=True)
            print('配置：已配置，格式有效。' if config else '配置：尚未配置，请运行 configure。')
            return 0
        if args.command == 'configure':
            configure()
            return 0
        if args.command == 'bug' and args.id <= 0:
            raise ZenTaoError('Bug 编号必须是正整数。')
        config = load_config()
        client = Client(config)
        client.login(password_for_query(config))
        data = client.assigned() if args.command == 'assigned' else client.bug(args.id)
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return 0
    except (ZenTaoError, subprocess.TimeoutExpired) as error:
        message = str(error) if isinstance(error, ZenTaoError) else '系统凭据库操作超时，请检查系统授权。'
        print(json.dumps({'error': message}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
