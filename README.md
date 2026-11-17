# zentao-personal

面向 Codex、Claude Code 和 Cursor 的个人禅道 Bug 技能，附带 Windows／macOS 可用的 npx 交互向导。

查询分配给自己的 Bug、读取详情；需要修复时，AI 识别工作区项目，通过宿主选择框引导选择项目、当前分支或新建修复分支，再定位代码并验证。

```text
npx zentao-personal
```

↑↓ 选择 · 空格多选 · Enter 确认 · Esc 取消。向导可安装技能、配置自己的账号、查询 Bug、选择项目与分支、检查环境。安装时选择用户范围或当前项目，并多选目标工具。

## 环境与首次使用

需要 Node.js 20+ 和 Python 3.9+。CLI 无 npm 运行时依赖，无 postinstall 脚本。

1. 执行 `npx zentao-personal`，选择“安装／更新技能”。
2. 选择 Codex、Claude Code、Cursor 中的一个或多个工具。
3. 执行 `npx zentao-personal configure`，输入自己的站点、账号和密码。
4. 在 AI 工具中说“读取我的禅道 Bug”或“帮我修复 Bug 123”。

Windows：支持 PowerShell 和 Windows Terminal，自动检测 `py -3`／`python`／`python3`。凭据向导可自动创建用户级 Python venv 并安装 keyring，保存到 Windows Credential Manager。安装 Python 时应勾选加入 PATH。

macOS：自动检测 `python3`，使用系统钥匙串。Linux 可使用 keyring 与系统凭据后端，或在交互终端按次输入密码。

密码不写入配置文件、不作为命令行参数传递。配置在 `~/.config/zentao-personal/config.json`，每个用户独立使用。未保存凭据时，AI 后台不能代替用户输入密码。

## 常用命令

```text
npx zentao-personal install --user --tools codex,claude,cursor --yes
npx zentao-personal install --project --tools cursor --yes
npx zentao-personal configure
npx zentao-personal credentials
npx zentao-personal assigned
npx zentao-personal bug 123
npx zentao-personal context
npx zentao-personal context --json
npx zentao-personal doctor
```

更新安装加 `--force`。`context` 只读识别当前目录及直接子目录的 Git 仓库，并输出处理方案，本身不会创建或切换分支。

| 工具 | 用户安装 | 项目安装 |
| --- | --- | --- |
| Codex | `~/.agents/skills/zentao-personal` | `.agents/skills/zentao-personal` |
| Claude Code | `~/.claude/skills/zentao-personal` | `.claude/skills/zentao-personal` |
| Cursor | `~/.cursor/skills/zentao-personal` | `.cursor/skills/zentao-personal` |

原生选项框取决于宿主提供的提问工具和当前运行模式。技能指引优先使用原生选项，不支持时使用编号文字选项；终端安装器提供自己的箭头菜单。

## GitHub 与技能市场安装

仓库根目录包含标准 `SKILL.md`，可由支持 Agent Skills 的工具安装：

```text
npx skills add https://github.com/zhan1024/zentao-personal --skill zentao-personal
```

也可下载完整仓库，放入上表对应目录，保留 `bin/`、`lib/`、`scripts/`、`references/` 和 `package.json`。SkillsMP 从公开 GitHub 仓库索引技能，是否收录及收录时间由平台决定。

## 兼容性与权限范围

禅道旧版只读接口已在 **18.7** 验证，其他版本需要实测适配。验证码、企业 SSO 或接口不匹配会给出错误，不会当作“没有 Bug”。安装器适配 Windows/macOS 路径及 Python 启动方式，仓库 CI 在 Windows、macOS、Linux 上运行自动化测试。系统凭据授权仍需在各使用者机器验证。

默认仅查询自己的 Bug。代码修复依据用户当前请求；技能安装不自动提交、推送、部署或修改禅道记录。

开发验证：`npm test`；`python -m unittest discover -s scripts -p "test_*.py"`；`npm pack --dry-run`。MIT License。
