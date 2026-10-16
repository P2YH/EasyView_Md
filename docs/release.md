# EasyView 桌面端发布

## 流程与版本来源

`.github/workflows/release.yml` 由推送 `v*` tag 触发，也支持手动输入已有 tag。发布版本必须是稳定版 `vX.Y.Z`，且去掉 `v` 后与该 tag 下的 `apps/desktop/package.json` 版本完全一致，否则在构建前失败。手动运行也只检出 `refs/tags/<tag>`，不能使用分支代替。

同一 matrix 在 `macos-14` 原生 arm64 和 `windows-latest` 原生 x64 上构建。构建后执行现有包内容检查与打包应用运行检查。聚合 job 生成校验与清单，再通过 `gh` 创建 Release，附件如下：

- `EasyView_Md-mac-arm64.dmg`
- `EasyView_Md-mac-arm64.zip`
- `EasyView_Md-win-x64-setup.exe`
- `EasyView_Md-win-x64.zip`
- `easyview-md.vsix`：VS Code / Cursor 扩展，版本见下文“VS Code 扩展（VSIX）”。
- `SHA256SUMS`：上述五个文件的 SHA-256。
- `EasyView_Md-win-x64-store.appx`：微软商店上传用的未签名包，见下文“微软商店（MSIX / AppX）”；不计入 `SHA256SUMS` 和 `release.json`。
- `release.json`：产品、tag、desktopVersion、extensionVersion，以及每个文件的文件名、大小和 SHA-256。

Release 先创建为草稿，上传完成后公开。失败重跑时，草稿继续上传；已公开的 Release 下载原始附件用于官网同步，不覆盖已发布的安装包。

公开后，用 SSH/rsync 上传四个安装包、`easyview-md.vsix` 和 `SHA256SUMS` 到 `/opt/services/sites/easyview/downloads/`，服务器执行 `sha256sum -c SHA256SUMS`，成功后上传 `release.json`。最后更新 `tiantianmanmanzou/WonderXY-ART` 的 `main`：只提交 `sites/easyview/index.html` 中桌面端两处版本文字、三条桌面下载链接的 `?v=` 参数，以及扩展卡片的版本文字和下载链接，由其现有 `deploy.yml` 自动部署。官网部署使用的 `--exclude 'downloads/'` 保留服务器上的下载文件。

所有桌面发布共用一个 concurrency 队列，避免同时写固定下载文件名。GitHub 不保证排队顺序，也可能替换尚未开始的 pending run；应等上一版完成再发下一版。手动重跑历史 tag 会把官网下载切回该版本，应只重跑准备对外提供的版本。固定下载路径逐文件替换，整组文件不是原子切换；同步失败时官网 HTML 不更新，但部分安装包可能已经替换，应及时重跑同步。

Windows 官网安装包 `EasyView_Md-win-x64-setup.exe` 是 NSIS 安装向导：Windows job 在 Forge `make` 之后运行 `npm run make:nsis --workspace @easyview/desktop`，用 electron-builder 把 Forge 产物重新打包，程序文件与 ZIP、商店版一致。随后 `.github/scripts/windows-install-test.ps1` 分别以“仅为我”（`/currentuser`）和“所有用户”（`/allusers`）静默安装到含空格的自定义目录，校验版本、卸载项、“打开方式”注册和快捷方式，启动冒烟测试后静默卸载并检查清理，失败则阻止发布。2.0.14 及以前的 Squirrel 安装不会被自动卸载，用户可在“应用和功能”中自行移除。

VSIX 随同一 tag 构建与发布，但扩展版本号独立维护。现有 Desktop Build 仅保留应用打包与运行验证，不制作发布安装包；旧 `desktop-release.yml` 已由新流程替代。

## VS Code 扩展（VSIX）

VSIX 与桌面端走同一条 Desktop Release 流程，但版本独立：tag 只对应桌面版本，扩展版本取自该 tag 下的 `apps/vscode-extension/package.json`（`version` job 输出 `extension_version`）。

- macOS 构建 job 在打完 dmg 后运行 `npm run package:vscode` 和 `npm run verify:vscode-package`，再用 `desktop-artifacts.mjs stage-vsix` 改名为固定文件名 `easyview-md.vsix`。VSIX 内含 node-pty 各平台预编译文件，与构建平台无关，只构建一次。
- `easyview-md.vsix` 与四个安装包一起进入 Release 附件、`SHA256SUMS`、`release.json`（新增 `extensionVersion` 字段）和服务器同步。
- 官网更新同时改写扩展卡片的 `vX.Y.Z · .vsix` 文字和 `easyview-md.vsix?v=X.Y.Z`（`data-easyview-extension-version` / `data-easyview-extension-download` 标记）。
- 扩展版本没变时也会重新打包并上传同版本 VSIX，内容来自该 tag 的源码。
- 本流程不发布到 VS Code Marketplace 或 Open VSX，商店发布仍需单独操作（微软商店见下文，已自动提交）。

## 微软商店（MSIX / AppX）

商店版与官网安装包走同一个 tag 构建，但只作为 GitHub Release 附件，不进 `SHA256SUMS`、`release.json`，也不同步到下载服务器或官网。

- **构建方式：** Windows job 在 Forge `make` 之后运行 `npm run make:appx --workspace @easyview/desktop`。`apps/desktop/scripts/make-appx.mjs` 用 electron-builder（配置 `apps/desktop/electron-builder.store.cjs`）把 Forge 产物 `out/EasyView_Md-win32-x64` 重新打成 `out/store/EasyView_Md-win-x64-store.appx`，程序文件与官网版一致。只能在 Windows 上打；在 macOS 上可用 `node apps/desktop/scripts/make-appx.mjs --check` 校验配置。
- **身份信息：** 与 Partner Center 预留一致：`identityName` `wonderxy.EasyViewMd`、`publisher` `CN=19709C1F-89CA-4443-8E7F-815C01CEC37E`、`publisherDisplayName` `wonderxy`、显示名 `EasyView_Md`，Store ID `9MTQTBP489CN`，PFN `wonderxy.EasyViewMd_aeg7cng3hy970`。不要改这些值。
- **不签名：** 商店提交不需要自己签名，Partner Center 会用微软证书重新签名。配置里没有证书，脚本在检测到 `CSC_LINK` / `WIN_CSC_LINK` / `CSC_NAME` 时直接失败。未签名的包不能直接双击安装，本地测试需开启开发者模式后用 `Add-AppxPackage` 安装。
- **磁贴图标：** 在 `apps/desktop/build/appx/`，由 `node tooling/brand/generate-appx-assets.mjs`（macOS）从 `resources/brand/logo.png` 生成。换品牌图后重新生成并提交。
- **自动提交：** Release 发布后 `store` job（windows-latest）用 `microsoft/microsoft-store-apppublisher@v1.1` 安装 `msstore`。CLI 的独立安装包发布器按 `.msix` 扩展名识别文件，因此将既有 AppX 原样复制为 `.msix`，执行 `msstore publish …msix --appId 9MTQTBP489CN`：以上次已发布的提交为底新建提交，只替换程序包，商店信息不变，并直接提交认证。缺任一 secret 时只给 warning 跳过，不影响发版。关闭：仓库变量 `STORE_SUBMIT=false`，或手动运行时取消 `store_submit`。
- **仅提交现有安装包：** 手动运行 Desktop Release，填写已有 Release 的 `tag`，启用 `store_only` 和 `store_submit`。流程校验 tag 后跳过构建和官网同步，直接下载该 Release 的 `EasyView_Md-win-x64-store.appx` 并执行同一个 `store` job，不重新打包。命令：`gh workflow run release.yml --ref main -f tag=vX.Y.Z -F store_only=true -F store_submit=true`。
- **注意：** 版本号必须比商店现有版本大（`X.Y.Z` → `X.Y.Z.0`）；上一个提交还在认证中时新提交会失败或覆盖草稿，需等完成或在 Partner Center 处理；客户端密码过期后要更新 secret；更改描述/截图仍需在 Partner Center 手动做。
- **一次性配置（自动提交前）：**
  1. Partner Center → 右上角齿轮“帐户设置” → 用户管理 → **Microsoft Entra 应用程序**：关联已有 Entra 租户或新建，再“添加 Microsoft Entra 应用程序”（新建或选已注册的应用），角色选 **Manager**。
  2. 在 [Entra 管理中心](https://entra.microsoft.com/) → 应用注册 → 该应用 → 证书和密码 → 新建客户端密码，**立即复制值**（只显示一次，记下过期时间）。
  3. 记下 ID：租户 ID（Entra → 概述）、客户端 ID（应用注册 → 应用程序(客户端) ID）、Seller ID（Partner Center → 帐户设置 → 开发者设置或“标识符” → Seller ID / Publisher ID）。
  4. GitHub 仓库 Settings → Secrets and variables → Actions 新增 `PARTNER_CENTER_TENANT_ID`、`PARTNER_CENTER_SELLER_ID`、`PARTNER_CENTER_CLIENT_ID`、`PARTNER_CENTER_CLIENT_SECRET`。
  - 官方说明：[GitHub Actions 发布](https://learn.microsoft.com/windows/apps/publish/msstore-dev-cli/github-actions)、[关联 Entra 应用](https://learn.microsoft.com/windows/apps/publish/partner-center/add-users-groups-and-azure-ad-applications)、[提交 API 前置条件](https://learn.microsoft.com/windows/uwp/monetize/create-and-manage-submissions-using-windows-store-services)、[msstore 命令](https://learn.microsoft.com/windows/apps/publish/msstore-dev-cli/commands)。
- **手动提交（备用）：** 发版后在 Release 下载 `EasyView_Md-win-x64-store.appx`（或 Actions 运行里的 `store-win32-x64` artifact），打开 [Partner Center](https://partner.microsoft.com/dashboard/apps-and-games/overview) → EasyView_Md（9MTQTBP489CN）→ 新建提交 → 程序包，上传后补齐商店信息（描述、截图、分类、年龄分级）再提交审核。每次提交的版本号必须比上一次大（`X.Y.Z` 会成为 `X.Y.Z.0`）。
- **隐私政策：** 商店要求填写隐私政策链接，需先在官网放一页（例如 `https://easyview.wonderxy.art/privacy.html`）再提交。
- **不自动更新：** 应用没有静默自动更新（不使用 electron-updater），只会提示并下载官网安装包。商店版的更新只由微软商店完成，以后若加入应用内更新，需在 `process.windowsStore === true` 时跳过。

## GitHub Secrets

在 **EasyView_Md → Settings → Secrets and variables → Actions → Repository secrets** 配置：

| Secret | 用途 | 获取或生成方式 |
| --- | --- | --- |
| `EASYVIEW_DEPLOY_SSH_KEY` | 下载服务器 SSH 私钥 | 在可信机器使用 `ssh-keygen -t ed25519 -N '' -f <专用密钥路径>` 生成专用密钥；公钥由管理员加入部署账号 `authorized_keys`，私钥通过 GitHub 设置页面录入。不要放进仓库或日志。 |
| `EASYVIEW_DEPLOY_HOST` | 服务器域名或 IPv4 地址 | 由服务器管理员提供，不带协议或端口。 |
| `EASYVIEW_DEPLOY_USER` | SSH 部署账号 | 使用能写下载目录、执行 `mkdir` 和 `sha256sum` 的账号，由管理员配置目录权限。 |
| `EASYVIEW_DEPLOY_PORT` | SSH 端口 | 管理员提供的数字端口，需显式配置。 |
| `EASYVIEW_DEPLOY_KNOWN_HOSTS` | 固定可信服务器主机公钥，启用严格主机校验 | 管理员提供并通过可信渠道核对服务器主机密钥及指纹；保存 OpenSSH known_hosts 格式。非 22 端口的主机字段应是 `[host]:port`。不要把未经核验的扫描结果当作可信依据。 |
| `WONDERXY_ART_TOKEN` | 检出官网仓库、提交并推送其 main，触发部署 | GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens；Resource owner 选 `tiantianmanmanzou`，仅授权 `WonderXY-ART`，Repository permissions 的 **Contents: Read and write**，Metadata 使用默认读取。设置有效期并及时轮换。Token 所属账号须有该仓库写权限。 |

`GITHUB_TOKEN` 由 Actions 自动提供，无需手动创建。发布 job 声明 `contents: write`，用于 EasyView Release；其他 job 使用读取权限。跨仓库推送使用独立 PAT，不能用 EasyView 的 `GITHUB_TOKEN` 代替。PAT 推送可以触发官网 `push` 工作流，参见 [GitHub 工作流触发说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。

WonderXY-ART 原有部署 secrets 仍需有效：`DEPLOY_SSH_KEY`、`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_PORT`、`DEPLOY_PATH`。这些是官网部署的配置，不由 EasyView secrets 自动传递。无需改动原部署工作流。

两个仓库必须启用 Actions。官网 `main` 的分支保护/规则必须允许 token 所属账号直接推送这个页面更新；要求全部变更经 PR 审核的规则会使自动 push 失败，需由管理员决定如何授权。服务器需安装 `rsync` 和 `sha256sum`，部署账号需能写目标目录。Workflow 不包含代码签名或 Apple notarization；需要签名发布时，应另行配置证书和对应流程。

## 首次启用

先提交并推送 WonderXY-ART 的脚本与页面标记修改到 `main`，再提交并推送 EasyView 的发布改造，配置上述 secrets，然后发 tag。新流程运行时会读取官网 `main` 中的脚本，因此顺序不能颠倒。手动运行需要新 workflow 已存在于 EasyView 默认分支。

## 以后发版的三步操作

1. 完成变更并确定桌面版本。用 `npm version X.Y.Z --workspace @easyview/desktop --no-git-tag-version` 更新桌面 package 与锁文件，检查 diff 后提交；扩展需要发新版时，另行修改 `apps/vscode-extension/package.json` 的版本并一起提交。将对应提交推送到主分支。
2. 在要发布的提交上创建 tag：`git tag vX.Y.Z`。
3. 推送这个 tag：`git push origin vX.Y.Z`。

随后检查 EasyView 的 **Desktop Release** 运行成功、GitHub Release 附件齐全、WonderXY-ART 的 **Deploy** 成功，以及官网版本文字和下载文件校验值一致。主分支推送本身只执行日常 CI，不创建 Release。

## 手动重跑

- 在 Actions → Desktop Release → 对应运行中使用 **Re-run failed jobs**。失败在官网同步/推送时会重跑 publish job，复用已上传构建 artifacts 和已公开 Release。构建 artifacts 过期时，使用完整重跑。
- 使用 **Run workflow**，选择含新 workflow 的默认分支，输入已有 tag（例如 `vX.Y.Z`）。流程仍从该 tag 检出并校验版本，重新构建；已公开 Release 附件复用原文件。
- 如果 EasyView 已成功，而官网 Deploy 失败，直接在 WonderXY-ART Actions 重跑 Deploy 或使用其 Run workflow。官网 HTML 已是目标版本时 EasyView 不会生成空提交，也不会通过空提交重复触发部署。
- 官网 main 在发布期间发生并发修改，普通 push 可能被拒绝；工作流不强推。重跑 publish 会重新检出 main 并更新目标字段。

已有历史 Release（如 v2.0.1，没有 VSIX）若缺少本流程的固定文件名附件、`release.json` 或 `SHA256SUMS`，校验会失败；应使用新的未发布版本 tag，或先由维护者单独处理历史 Release 的附件。不要移动已发布 tag。Release 创建使用 [`gh release create --verify-tag`](https://cli.github.com/manual/gh_release_create)，防止自动创建未存在的 tag。

## 本地检查与脚本接口

所有目录都显式传入，CI 输出放在 runner 工作目录，不写官网仓库的 `sites/easyview/downloads/`。

```bash
node tooling/release/desktop-artifacts.mjs validate vX.Y.Z
node tooling/release/desktop-artifacts.mjs stage-vsix <固定文件名产物目录>
bash ../WonderXY-ART/scripts/prepare-easyview-downloads.sh <固定文件名产物目录> X.Y.Z <临时输出目录> --extension-version A.B.C --dry-run
bash ../WonderXY-ART/scripts/prepare-easyview-downloads.sh <固定文件名产物目录> X.Y.Z <临时输出目录> --extension-version A.B.C
node ../WonderXY-ART/scripts/easyview-release.mjs verify <临时输出目录> X.Y.Z [--extension-version A.B.C]
bash ../WonderXY-ART/scripts/sync-easyview-downloads.sh <临时输出目录> X.Y.Z --dry-run
node ../WonderXY-ART/scripts/easyview-release.mjs update-site <index.html副本> X.Y.Z --extension-version A.B.C --dry-run
```

prepare 的 dry-run 验证五个源文件存在且非空，不创建输出目录。sync 的 dry-run 验证清单和五个文件的大小、SHA-256 与版本，不读取密钥、不执行 SSH 或 rsync。update-site 的 dry-run 验证桌面端两处文字、三条链接以及扩展的一处文字、一条链接标记存在，不写文件。缺失、空文件、校验不符或页面标记数量异常会立即失败。
