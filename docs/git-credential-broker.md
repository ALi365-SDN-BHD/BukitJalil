# 发布时 GitHub token 不进 git 环境变量：实施方案

> 日期：2026-11-15 · 状态：方案，第 4 节的问题待定。Bukit 部分动代码前要用户确认开工 · 对应：[开发方案](development-plan.md) 6.7（运行中的进程）、8.5（token 走 stdin）
>
> 源码按 Bukit `v2.2.2`（`c1f341b1`）和 BukitJalil `pi-harness-ui` 核对。行号会随提交漂移，实施时以符号名为准，文中行号都是"约"。

## 1. 要解决的问题

### 1.1 现状

BukitJalil 把 GitHub token 经 `--secrets-stdin` 交给 Bukit（开发方案 8.5），token 只在 Bukit 进程的内存里。问题出在 Bukit 推送时：

- `GitHubPagesDeployProvider.Auth.cs`：`CreateAskpassScript` 在临时目录写一个 askpass 脚本。Unix 上是 `printf '%s\n' "${BUKIT_GITHUB_TOKEN:-}"`，Windows 上是一段读 `$env:BUKIT_GITHUB_TOKEN` 的 PowerShell。
- `GitHubPagesDeployProvider.Git.cs` 约 280–315 行：`RunGitAuthAsync`、`RunGitAuthAndCaptureAsync` 给 git 子进程设 `GIT_ASKPASS=<脚本>`、`GIT_TERMINAL_PROMPT=0`、**`BUKIT_GITHUB_TOKEN=<token>`**。
- 用到它们的三处（`GitHubPagesDeployProvider.cs` 约 120–200 行）：`ls-remote`（`RemoteBranchExistsAsync`）、`fetch`、`push`（含 `--force`）。

token 因此出现在 git、`git-remote-https` 和 askpass 脚本这几个进程的环境变量里，整个认证命令运行期间一直在。大网站推送可能持续几十秒到几分钟。

### 1.2 谁能读到

| 平台 | 方式 |
|---|---|
| macOS | 同一用户：`ps -E -p <pid>`（`sysctl KERN_PROCARGS2`），不需要额外权限 |
| Linux | 同一用户：`/proc/<pid>/environ` |
| Windows | 同一用户：读进程的 PEB 环境块 |

相比之下，读 Bukit 进程的内存要难得多：macOS 上普通程序拿不到 `task_for_pid`；Linux 上默认的 Yama `ptrace_scope=1` 只允许读自己的子进程。所以 git 的环境变量是 token 现在最容易被读到的地方，也是开发方案 6.7 里列出的"剩下一处"。

### 1.3 为什么不能直接"用管道交给 git"

- git 只在需要密码时才自己启动 askpass 或 credential helper。中间还隔着 `git-remote-https`，Bukit 控制不到这一层。
- .NET 的 `Process.Start` 不能给子进程传额外的文件描述符或句柄，所以没法把一根现成的管道一路递到 helper 手里。
- 写 token 文件、放进命令行参数或 `-c http.extraHeader=…`，同一用户一样能读到（文件、`ps` 看到的参数）。

所以只能反过来：让 helper 主动向 Bukit 要，Bukit 核对来要的是谁再给。

## 2. 目标和不做的事

**目标**

1. 推送期间，token 不出现在任何子进程的环境变量、命令行参数或磁盘文件里。
2. 只有 Bukit 自己启动的那个 git 调用（及其子孙进程）能拿到 token；同一用户的其他程序连上来也拿不到。
3. git 不会把 token 存进用户的凭据存储（osxkeychain、Git Credential Manager、`~/.git-credentials` 等）。
4. 报错照旧脱敏，失败时给出明确原因；任何失败都不退回到环境变量的方式。

**不做的事**

- 不起 HTTP 服务、不占 TCP 端口：TCP 查不出对方是哪个进程，还要防网页和 DNS 重绑定。
- 不防 root、管理员，以及能调试或注入 git 进程的同一用户程序（Linux 上 `ptrace_scope=0` 时可以），和读 Bukit 内存属于同一级别。
- 不改 BukitJalil 把 token 交给 Bukit 的方式（`--secrets-stdin` 已经满足要求）。
- 不改 `Bukit.Labs` 的 webhook 命令（它是从用户自己的环境变量读 token，不在 BukitJalil 的路径上）。

## 3. 设计

### 3.1 整体流程

```
Bukit deploy（token 只在内存里）
 ├─ 1. GitCredentialBroker.Start()：在 0700 临时目录开 Unix socket（Windows：命名管道）
 ├─ 2. 每次认证的 git 调用：
 │      git -c credential.helper= \
 │          -c credential.helper=<bukit 的 helper 命令> \
 │          -c core.askPass= -c credential.useHttpPath=false \
 │          <ls-remote | fetch | push …>
 │      环境：GIT_TERMINAL_PROMPT=0，不设 GIT_ASKPASS，没有 token
 │      Process.Start 之后，把 git 的 pid 登记给 broker（这次调用的"可信根"）
 │
 │   git → git-remote-https → 需要密码
 │     └─ 启动 helper：bukit __git-credential <socket> get
 │          ├─ 从 stdin 读 git 的请求（protocol=https, host=github.com, …）
 │          ├─ 连接 socket，转发请求（不含任何秘密）
 │          │     broker：取对方 pid → 核对它是登记的 git 的子孙 → 核对 host
 │          │             → 回 username / password，或拒绝
 │          └─ 把回答按 git credential 格式写到 stdout，退出
 │
 └─ 3. git 调用结束：注销这个 pid；整个部署结束：关掉监听，删除临时目录
```

### 3.2 helper 子命令 `__git-credential`

- **形式**：Bukit 新增隐藏子命令 `bukit __git-credential <socket 路径或管道名> <get|store|erase>`，不出现在 `--help` 里。用 Bukit 自己的可执行文件，三个平台写法一致，不依赖 `sh` 或 PowerShell，也兼容 native AOT。
- **git 怎么调用**：`credential.helper` 的值按 git 的规则解析，开头不是 `!` 的绝对路径会当作命令执行，后面追加 `get` / `store` / `erase`。Bukit 生成的值是：

  ```
  "<Environment.ProcessPath>" __git-credential "<socket>"
  ```

  路径要按 git 的 shell 引号规则转义（空格、引号、Windows 反斜杠），见 3.6 和风险表。实际是否用 `!` 前缀以三个平台的测试为准。
- **`get`**：
  1. 从 stdin 按 git credential 协议读 `key=value` 行，直到空行或 EOF，最多 64 KiB；
  2. 只把 `protocol`、`host`、`path`（如有）转给 broker；
  3. broker 同意就输出 `username=x-access-token`、`password=<token>` 和一个空行；拒绝或出错就什么也不输出，以 0 退出，让 git 自己报认证失败。
- **`store` / `erase`**：读完 stdin 后直接以 0 退出，什么也不做（git 认证成功会调 `store`，失败会调 `erase`）。
- **超时**：连接加等待回答最多 10 秒，超时就像拒绝一样处理。
- **输出纪律**：token 只写到 stdout 给 git；stderr 只写不含 token 的一行原因；不写日志文件。
- **不读配置**：这个子命令不加载 `site.yaml`、不初始化日志和插件，启动开销尽量小。

### 3.3 broker 与通信协议

**监听位置**

- **macOS / Linux**：Unix 域套接字。路径是 `<临时目录>/c.sock`，临时目录 0700。`sockaddr_un.sun_path` 有长度限制（macOS 104 字节、Linux 108 字节），而 macOS 的 `$TMPDIR` 很长，所以 socket 单独放在一个短目录里：先试 `Path.GetTempPath()`，太长就用 `/tmp/bukit-<12 位随机>`，创建时 0700，并检查它不是符号链接、属于当前用户。
- **Windows**：命名管道 `\\.\pipe\bukit-cred-<32 位随机>`。用 `NamedPipeServerStreamAcl.Create` 设置只允许当前用户 SID 访问；加 `PipeOptions.CurrentUserOnly`，并拒绝远程客户端（`PIPE_REJECT_REMOTE_CLIENTS`）。

**协议**：每个连接只交换一次，都是一行 UTF-8 JSON，最长 4 KiB：

```
helper → broker   {"v":1,"protocol":"https","host":"github.com"}
broker → helper   {"v":1,"username":"x-access-token","password":"…"}
                  或 {"v":1,"deny":"peer"|"host"|"limit"}
```

broker 回完就关闭连接。版本号 `v` 不一致时直接拒绝（helper 和 broker 是同一个可执行文件，正常情况下不会不一致）。

**生命周期**

- 一次 `deploy` 只建一个 broker，在创建临时目录之后启动（原来调用 `CreateAskpassScript` 的位置），在原来的 `finally`（`CleanupAskpassScript` 的位置）里停止，并删除 socket 和目录。
- 监听在后台任务里进行。每个连接单独处理，同一时间最多处理几个连接，多的直接关闭。
- 只在有登记的 git 调用时才交出 token（见 3.4）；空闲时有人连上来一律拒绝。

### 3.4 核对对方进程（安全的关键）

0700 目录和管道 ACL 只能挡住其他用户，挡不住同一用户的其他程序。所以 broker 收到连接后，要先查清对方是谁，再决定给不给。

**1. 取对方 pid 和用户**

| 平台 | 对方 pid | 对方用户 |
|---|---|---|
| macOS | `getsockopt(SOL_LOCAL, LOCAL_PEERPID)` | `getpeereid` |
| Linux | `getsockopt(SOL_SOCKET, SO_PEERCRED)`（`struct ucred`） | 同一结构里的 uid |
| Windows | `GetNamedPipeClientProcessId` | `ImpersonateNamedPipeClient` 后取令牌 SID，或比对进程令牌 |

对方用户必须是当前用户，否则拒绝。

**2. 核对它是不是登记的 git 的子孙**

每次 `RunGitAuth*` 在 `Process.Start` 之后把 git 的 pid（及启动时间）登记为可信根，调用结束后注销。核对时从对方 pid 开始，沿父进程一层层往上找，最多 `MaxDepth` 层，找到任一可信根就算通过。正常的链是：

```
helper  →  git-remote-https  →  git（可信根）
```

`!` 写法会多一层 shell，Windows 上 git for Windows 可能多一层。`MaxDepth` 默认 4，见第 4 节 Q2。

取父 pid 的方法：

| 平台 | 方法 | 可复用的现有代码 |
|---|---|---|
| macOS | `proc_pidinfo(pid, PROC_PIDTBSDINFO)` 取 `pbi_ppid` 和 `pbi_start_tvsec` | `Bukit.PluginHost/ProcessTree/PlatformProcessTreeLimiter.cs` 已经 P/Invoke 了 `proc_pidinfo`、`proc_listchildpids` |
| Linux | 读 `/proc/<pid>/stat` 第 4 个字段（ppid）和第 22 个字段（starttime），注意 `comm` 里可能有括号和空格 | `PlatformProcessTreeLimiter.TryReadStatField` 已经能解析 stat |
| Windows | `CreateToolhelp32Snapshot` + `Process32First/Next` 取 `th32ParentProcessID`；用 `GetProcessTimes` 比对启动时间 | 没有，要新写 |

另一种做法是**往下找**：从可信根出发列出子孙进程，看对方 pid 在不在里面。macOS 和 Linux 上 `ExternalToolProcessTree` / `PlatformProcessTreeLimiter` 已经有列子进程的代码，可以直接复用。往上找只看一条链，更快也更简单；往下找能复用更多代码。实现时二选一，见第 4 节 Q4。

**pid 复用**：对方正连着 socket 等回答，不会在核对的那一刻退出，所以对方 pid 本身可靠。链上的父进程理论上可能刚好退出、pid 被复用，所以每一层同时比对启动时间：子进程的启动时间不能早于父进程，可信根的启动时间要和登记时一致。

**3. 核对请求**

- `protocol` 必须是 `https`，`host` 必须是 `github.com`（不区分大小写，不允许带端口或用户名）。`EnsureTransportTargetAsync` 已经核对远端地址，这里再拦一层，防止 git 被配置（`url.<base>.insteadOf` 等）改写后把 token 发到别的地方。
- 每个可信根最多交出 `MaxGrants` 次（默认 3 次）。git 认证失败会重试，所以不能只交一次，但要设上限。

**4. 记录**：拒绝时记一条警告，内容只有原因（`peer` / `host` / `limit`）和对方 pid，不含 token。

### 3.5 git 的配置参数

每次认证的 git 调用（`ls-remote`、`fetch`、`push`），在子命令之前加：

```
-c credential.helper=
-c credential.helper=<bukit helper 命令>
-c core.askPass=
-c credential.useHttpPath=false
```

环境变量：`GIT_TERMINAL_PROMPT=0`，**删除** `GIT_ASKPASS`、`SSH_ASKPASS`，不再设 `BUKIT_GITHUB_TOKEN`。

- **第一个空的 `credential.helper=`**：git 的 helper 是一个列表，空值会清掉之前所有层级（系统、全局、仓库）的配置。这样用户自己的 osxkeychain、manager 等 helper 既不会被问到，也不会在认证成功后把 token 存进去。命令行 `-c` 的优先级最高。
- **`core.askPass=` 置空，并删除 `GIT_ASKPASS`**：防止用户的 askpass 被调用。
- **`credential.useHttpPath=false`**：请求里不带仓库路径，只按 host 核对。
- **`CreateGitProcess`** 原样保留：它已经删除会改变仓库位置的 `GIT_*` 变量，以及 `GIT_CONFIG_PARAMETERS`、`GIT_CONFIG_COUNT`、`GIT_CONFIG_KEY_*`、`GIT_CONFIG_VALUE_*`，所以用户无法通过环境变量注入配置来盖掉上面的参数。
- **BukitJalil**：调用 Bukit 时，git 已经在加固过的环境里运行（`GIT_CONFIG_GLOBAL` 指向空文件等，开发方案 7.3）。这里是 Bukit 自己再保证一次，用户直接运行 `bukit deploy` 时同样安全。

### 3.6 改动位置（Bukit）

| 文件 | 改动 |
|---|---|
| `Bukit.Cli/Deploy/GitCredentialBroker.cs`（新） | 监听、协议、可信根登记、核对、次数限制、停止和清理 |
| `Bukit.Cli/Deploy/PeerProcess.cs`（新，或放进现有 ProcessTree 共享库） | 三个平台：取对方 pid 和用户、取父 pid 和启动时间 |
| `Bukit.Cli/Commands/GitCredentialCommand.cs`（新） | 隐藏子命令 `__git-credential` |
| `Bukit.Cli/Program.cs` | 注册隐藏子命令，确保不出现在帮助和补全里 |
| `GitHubPagesDeployProvider.Auth.cs` | 删除 `CreateAskpassScript`、`CleanupAskpassScript`、`AskpassTokenEnvironmentVariable`；新增生成 helper 命令值（含引号转义）的函数 |
| `GitHubPagesDeployProvider.Git.cs` | `RunGitAuthAsync`、`RunGitAuthAndCaptureAsync` 改为接收 broker：加 3.5 的参数，启动后登记 pid、结束后注销 |
| `GitHubPagesDeployProvider.cs` | 用 broker 替换 askpass 的创建和清理；`SanitizeError` 的敏感路径改为 socket 路径和临时目录 |
| `GitHubPagesDeployProvider.Validation.cs` | `SanitizeError` 不变，补上新路径 |
| 测试（见 3.7） | 改 `GitHubPagesDeployProviderTests`、`DeployIdentityTransportTests`、`WindowsGitShim` 里依赖 askpass 和 `BUKIT_GITHUB_TOKEN` 的部分 |

公开 API：这些都是 `internal` 或 `private`，public-api-drift 应该没有变化；如果有，审查后更新基线。

### 3.7 测试

**单元测试（Bukit.Cli.Tests）**

1. 协议：请求和回答的解析；超长、坏 JSON、版本不对都拒绝。
2. helper 命令值的引号转义：路径里有空格、单引号、双引号、反斜杠（Windows），git 解析后能还原成原路径（用真实 git 的 `git config --get` 加一个小 helper 实际调用一次来验证）。
3. 核对规则：
   - 对方是登记 pid 的子孙：给；
   - 不是：拒绝；
   - 超过 `MaxDepth`：拒绝；
   - 可信根已注销：拒绝；
   - 启动时间不一致：拒绝；
   - 超过 `MaxGrants`：拒绝；
   - host 不是 `github.com` 或协议不是 https：拒绝。
4. 平台层：本进程连接自己的 socket，取到的 pid 和用户正确；启动一个子进程连接，往上能找到本进程。

**集成测试**

5. **环境变量里没有 token**：用一个假 git（测试已有 `WindowsGitShim` 这类替身）把自己和子进程的环境变量写进文件，再通过 helper 拿密码。断言所有记录里都没有 token，也没有 `GIT_ASKPASS`。
6. **冒领**：测试进程自己（不是 git 的子孙）连上 broker 的 socket，拿不到 token。
7. **用户的 helper 不会被调用**：在临时 `HOME` 的全局 git 配置里放一个会记录调用的 helper，推送后它没有被调用，也没有存下任何东西。
8. **真实推送**：用 `git http-backend`（或测试已有的本地传输夹具）在本机起一个需要认证的仓库，只连本机，不连 GitHub。验证认证成功、错误 token 时报认证失败、helper 超时时报凭据获取失败。为了测试，host 核对要能在测试里放宽成本机地址（只开放给测试，正式代码路径固定为 `github.com`）。
9. **清理**：部署成功、失败、被取消后，临时目录和 socket 都不在了。
10. **Windows**：命名管道的 ACL、父进程查询、helper 路径引号，在 Windows CI 上跑第 5–9 项。

**质量门**：`dotnet-format`、analyzer ratchet、public-api-drift 都通过，复杂度不超过基线（AGENTS.md 的 C# 规则）。

**BukitJalil**

11. 用新版 Bukit 跑 `test/bukit-behavior.test.ts` 和部署相关测试（`deploys` 的单元测试和 e2e），确认部署报错的文字和结构没变（`bukit/report-errors.ts`、部署结果翻译依赖它们）。
12. 部署 e2e 的假 Bukit 不涉及 git 认证，不用改。

## 4. 待定的问题

| 编号 | 问题 | 建议 |
|---|---|---|
| Q1 | Windows 是否和 macOS、Linux 一起做？ | **一起做**。不然 Windows 上仍要保留 askpass 加环境变量的旧路径，两套代码都要维护；Windows 版现在虽然只是预览，但 CI 已经能跑 Windows。如果工期紧，退一步：Windows 先保留旧路径，文档写明限制，下个版本补上。 |
| Q2 | 往上核对父进程最多几层（`MaxDepth`）？ | **4 层**：helper → shell → git-remote-https → git，再留一层余量给 Windows。 |
| Q3 | 每次 git 调用最多交出几次 token（`MaxGrants`）？ | **3 次**，覆盖 git 正常的重试。 |
| Q4 | 核对方向：从对方往上找，还是从可信根往下找？ | **往上找**：只看一条链，快、简单、不会遍历整棵进程树；需要新写"取父 pid"，但 macOS 和 Linux 上大部分是现成的 P/Invoke 和 stat 解析。 |
| Q5 | helper 拿不到 token 时，部署报什么？ | Bukit 加一个明确的部署错误：`GitHub credential could not be provided to git`，附拒绝原因（不含 token）。BukitJalil 按现有的"部署失败"显示，不新增翻译码；如果 Bukit 给了错误码，以后再接。 |
| Q6 | Bukit 版本号 | 不改命令行和配置格式，只改内部实现，发 **2.2.3**。 |

## 5. 实施步骤

按 AGENTS.md 的分层做：实现 → 审计 → 修复 → 复查 → 提交推送。

### 第 1 层：平台层和 broker（约 0.75 天）

1. `PeerProcess`：三个平台取对方 pid、用户、父 pid、启动时间；能复用的复用 `PlatformProcessTreeLimiter` 里的 P/Invoke 和 stat 解析，必要时把它们挪到共享位置，不复制。
2. `GitCredentialBroker`：监听、协议、可信根登记和注销、核对、次数限制、清理。
3. 单元测试 1、3、4。

### 第 2 层：helper 子命令和 git 调用（约 0.5 天）

1. `__git-credential` 子命令，隐藏注册。
2. helper 命令值的生成和引号转义，测试 2。
3. `RunGitAuth*` 接上 broker，加 3.5 的参数；删除 askpass 脚本和 `BUKIT_GITHUB_TOKEN`。
4. 更新依赖 askpass 的现有测试。

### 第 3 层：集成测试和 Windows（约 0.5 天）

1. 集成测试 5–9。
2. Windows CI 跑通测试 10，修平台差异。

### 第 4 层：审计、修复、复查，Bukit 发版（约 0.25 天，发版要用户确认）

1. 独立审计，重点：核对逻辑能否绕过、pid 复用、helper 引号注入、清理是否完整、报错有没有带出 token。
2. 修复、复查，过质量门。
3. 发 Bukit 2.2.3（要用户确认）。

### 第 5 层：BukitJalil 升级 Bukit（约 0.5 天）

1. 升级 `BUKIT_VERSION`、`MIN_BUKIT_VERSION` 和三个安装包的 SHA-256（下载安装包前按规则征得用户同意）。
2. 跑测试 11；同步 Bukit 技能（如有变化）。
3. 文档：开发方案 6.7"运行中的进程"、8.5 第 5 条和安全表里的"剩下的缺口"改为已解决；用户手册的安全说明同步；版本号加一条修订记录。
4. 提交、推送；重新打包客户端。

### 合计

Bukit 约 2 天（含 Windows 和审计），BukitJalil 约 0.5 天。

## 6. 风险和对策

| 风险 | 影响 | 对策 |
|---|---|---|
| helper 路径的引号在某个平台上被 git 解析错 | git 找不到 helper，部署认证失败 | 测试 2 用真实 git 验证；路径含特殊字符的情况进 CI；失败时报明确错误而不是静默 |
| Unix socket 路径超长 | 无法监听 | 单独的短目录（3.3），创建前检查长度，超长时报明确错误 |
| 某些环境下多出一层进程（包装脚本、杀毒软件注入） | 合法的 helper 被拒绝 | `MaxDepth` 留余量；拒绝时日志记下对方进程链，便于调整 |
| Windows 取父 pid 和启动时间的 P/Invoke 在 native AOT 下出错 | Windows 部署失败 | 用 `LibraryImport`（源码生成，AOT 友好）；Windows CI 用 AOT 产物跑集成测试 |
| 用户的 git 配置盖掉 helper | token 被交给用户的 helper 或存下来 | 命令行 `-c` 优先级最高，加上空 helper 清空列表；`CreateGitProcess` 已删除 `GIT_CONFIG_*` 环境变量；测试 7 覆盖 |
| token 出现在 git 的报错输出里 | 泄露到日志和报告 | `SanitizeError` 照旧；集成测试断言报错里没有 token |
| broker 后台任务没停，进程退出慢 | 部署结束后 Bukit 卡住 | 停止时取消监听并等待最多 1 秒；测试 9 覆盖 |
| 改动 askpass 后，旧的部署报错文字变了 | BukitJalil 认不出部署失败原因 | 测试 11；只新增错误，不改已有错误的文字 |
