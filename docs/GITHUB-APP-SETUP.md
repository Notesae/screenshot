# 私有更新 GitHub App：发布者手动配置

此文是后续操作指引。本任务没有注册/安装 App、真实授权或配置任何 Client ID/secret/token/private key。默认候选是未配置状态；所有测试仅使用内存 HTTP 与虚构标识。无需向助手发送任何秘密。

1. 由 Notesae 账号在 GitHub Settings → Developer settings → GitHub Apps → New GitHub App 建立专用于 Screenshot 更新的 App。名称由发布者决定，Homepage 用官方仓库页面。启用 Device flow，保持用户访问令牌到期启用；不需要回调服务器，device flow 不使用回调。关闭 Webhook Active，无需创建 webhook secret、client secret 或私钥。
2. Repository permissions 仅设 Contents: Read-only；Metadata: Read-only 为必要基础权限。其余仓库、组织和账号权限均 None。不申请 OAuth `repo` scope。Contents 包含源码，使用者必须在授权前知情。
3. 安装到 Notesae，选择 **Only select repositories → screenshot**，不要 All repositories。先保持 App 仅本账号可安装；如果以后需要其他使用者，App 可用性/成员授权另行决定，不改变仓库 private 或公开产物。
4. 从 App 官方设置取得公开 **Client ID**（通常以 `Iv` 开头，不是 App ID）。这就是构建唯一需要的非秘密信息；不要提供 client secret、access token、refresh token 或 private key。
5. 用户提供 Client ID 后另行确认发布配置；后台构建可用 `./scripts/publish.ps1 -SkipRestore -Output <全新空目录> -GitHubClientId <公开ClientID>`，或 MSBuild `-p:ScreenshotGitHubClientId=<公开ClientID>`。构建参数只写入 AssemblyMetadata。未配置/格式不符保持禁用，当前 CI 默认不配置，不代表已可真实登录。
6. 经实机测试单独授权后，使用者在设置页点击登录，亲自在 `https://github.com/login/device` 输入本次短码，核对 App 名称和 Contents 权限；其 GitHub 账号必须原本拥有仓库读取权。页面不接受粘贴 token。核对完成后仍手动检查、下载并确认安装。
7. 设置页「退出登录」清除本机会话并取消请求；完整撤销由使用者到 GitHub Settings → Applications → Authorized GitHub Apps → 对应 App → Revoke。不能将本机退出声称为服务端撤销；本应用不会为自动远程撤销嵌入 client secret。

安全边界：设备码本身也应保密，只在官方页面使用，勿分享给他人。令牌默认只在原生进程内存，重启后重新登录；没有持久化选项。App/用户账号被入侵、同 Windows 用户进程被控制不在防护承诺内。API SHA 与包内清单校验不是发布者签名。

官方依据（2026-10-20 核对）：

- [注册 GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- [Device flow 与 repository_id](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [令牌到期和设备码刷新无需 client secret](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)
- [Release 资产 API 与 Contents read](https://docs.github.com/en/rest/releases/assets#get-a-release-asset)
- [Contents 权限的源码访问范围](https://docs.github.com/en/rest/repos/contents#get-repository-content)
- [撤销用户授权](https://docs.github.com/en/apps/using-github-apps/reviewing-and-revoking-authorization-of-github-apps)
