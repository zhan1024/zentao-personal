# 安装、配置与跨平台排查

在 Windows PowerShell、Windows Terminal 或 macOS Terminal 运行：

```text
npx zentao-personal
```

安装向导用上下箭头选择，空格多选，Enter 确认，Esc／Ctrl+C 取消。可选择 Codex、Claude Code、Cursor，以及当前用户或当前项目。`TERM=dumb` 使用编号输入。

| 工具 | 用户安装目录 | 当前项目安装目录 |
| --- | --- | --- |
| Codex | `~/.agents/skills/zentao-personal` | `.agents/skills/zentao-personal` |
| Claude Code | `~/.claude/skills/zentao-personal` | `.claude/skills/zentao-personal` |
| Cursor | `~/.cursor/skills/zentao-personal` | `.cursor/skills/zentao-personal` |

`~` 在 Windows 代表当前 Windows 用户的主目录（通常 `%USERPROFILE%`），路径由 Node 自动处理。旧版 Codex 已安装在 `~/.codex/skills` 的技能仍可原地更新；如果多个目录存在同名技能，请保留需要使用的版本，避免重复发现。

非交互安装：

```text
npx zentao-personal install --user --tools codex,claude,cursor --yes
npx zentao-personal install --project --tools cursor --yes
```

更新时添加 `--force`，这会替换目标 `zentao-personal` 目录中的技能文件；个人配置保存在技能目录之外。

## 配置自己的账号

```text
npx zentao-personal configure
npx zentao-personal assigned
npx zentao-personal bug 123
```

按提示填写自己的禅道站点（支持子目录）、账号、隐藏输入的密码。先验证登录再保存配置。不得把作者或其他人的个人 config.json 放进技能。已有配置可以回车保留站点和账号。

- macOS：使用系统钥匙串，保留旧的服务名和账号兼容；首次使用可能请求系统授权。
- Windows：向导可在用户目录创建独立 Python venv，安装 keyring，通过 Windows Credential Manager 保存凭据。可单独执行 `npx zentao-personal credentials` 准备环境，不修改全局 Python 包。
- Linux：keyring 需要可用的系统 Secret Service／凭据后端；缺少后端时使用交互查询。
- 未保存密码时可以在真实终端中每次输入；AI 后台执行需要已保存且可访问的系统凭据。

Node.js 20+ 用于向导与安装；Python 3.9+ 用于查询。Windows 优先检测 `py -3`；macOS 优先 `python3`。`npx zentao-personal doctor` 只检查环境和配置结构，不读取密码、不登录禅道。

个人配置位于 `~/.config/zentao-personal/config.json`，只含站点、账号和凭据服务标识。macOS／Linux 尽力设置权限 0600，Windows 文件访问由当前用户目录的 ACL 管理，不宣称 POSIX 权限可以替代 Windows ACL。

## 不使用 npm 的安装

从 GitHub 下载完整仓库，放到上表任一工具的技能目录（目录名称 `zentao-personal`）。必须保留 `bin`、`lib`、`scripts/zentao_read.py`、`package.json`、`SKILL.md` 和 `references`。安装不运行 postinstall，不要求全局管理员权限。

也可使用通用安装器：

```text
npx skills add https://github.com/zhan1024/zentao-personal --skill zentao-personal
```

## 支持范围

只读登录、分页和 Bug 详情接口已在禅道 18.7 验证。其他版本的路由／登录结构可能不同，首次应测试 `assigned` 和 `bug <编号>`。遇到验证码或企业 SSO 时需另行适配认证；脚本不会绕过验证码。

宿主选择框由各 AI 工具提供。技能包含原生提问指引，终端安装器提供箭头菜单；没有原生提问能力的模式使用编号文字选项。
