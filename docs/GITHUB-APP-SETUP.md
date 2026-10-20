# 私有更新 GitHub App：发布者手动配置

已发布 v0.4.7 包仍未配置 Client ID。用户后续提供了公开 Client ID `Iv23lisFgrPOh81NM4nz`，当前未发布源码已将其作为构建默认值，允许显式空覆盖以禁用。一次真实设备码试验成功取得短码，但原进程随后以通用授权错误结束，未建立可用会话；实际权限、检查和私有下载尚未通过。这不是已验证成功的登录版本。未代用户注册/安装 App、变更权限或撤销授权，未创建/保存任何 secret/token/private key。无需向助手发送秘密。

1. 由 Notesae 账号在 GitHub Settings → Developer settings → GitHub Apps → New GitHub App 建立专用于 Screenshot 更新的 App。名称由发布者决定，Homepage 用官方仓库页面。启用 Device flow，保持用户访问令牌到期启用；不需要回调服务器，device flow 不使用回调。关闭 Webhook Active，无需创建 webhook secret、client secret 或私钥。
2. Repository permissions 仅设 Contents: Read-only；Metadata: Read-only 为必要基础权限。其余仓库、组织和账号权限均 None。不申请 OAuth `repo` scope。Contents 包含源码，使用者必须在授权前知情。
3. 安装到 Notesae，选择 **Only select repositories → screenshot**，不要 All repositories。先保持 App 仅本账号可安装；如果以后需要其他使用者，App 可用性/成员授权另行决定，不改变仓库 private 或公开产物。
4. 从 App 官方设置取得公开 **Client ID**（通常以 `Iv` 开头，不是 App ID）。这就是构建唯一需要的非秘密信息；不要提供 client secret、access token、refresh token 或 private key。
5. 用户已提供上述公开 Client ID；后台构建可用 `./scripts/publish.ps1 -SkipRestore -Output <全新空目录> -GitHubClientId <公开ClientID>`，或 MSBuild `-p:ScreenshotGitHubClientId=<公开ClientID>`。构建参数只写入 AssemblyMetadata。不传该参数时使用工程公开默认值；显式 `-GitHubClientId ""`（或MSBuild同名属性空值）禁用登录。当前源码配置不修改已发布0.4.7，需另行确认新版本发行才能把它交付给已有用户；构建成功不代表真实登录成功。
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


后续试验限制：原等待进程已退出且没有持久化设备凭证，不能从原会话恢复；用户要求仅发起一次，因此再次设备登录需要用户明确确认。下一次试验前可由用户在官方页面核对 Device flow、Only select repositories→screenshot、Contents/Metadata只读及其他权限None；不要为排查失败增设权限。源码会读取当前 App 的安装元数据与仓库列表，发现范围不符即停止，不读取其他仓库或自动改授权。安装元数据检查不等于对全部注册设置完成独立审计。
