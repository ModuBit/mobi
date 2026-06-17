# mobi

## VS Code 调试配置

通过 `.vscode/launch.json` 可以在 VS Code 中调试 Bun 程序。

如果 VS Code 无法找到 Bun（常见于从 Dock/Spotlight 启动），需在用户级设置中指定 Bun 路径：

1. **Cmd+,** 打开设置，搜索 `bun.runtime`
2. 填入 Bun 可执行文件的绝对路径，例如：
   - macOS: `/Users/<你的用户名>/.bun/bin/bun`
   - Linux: `/home/<你的用户名>/.bun/bin/bun`

## 移动端 HTTPS 测试

移动端 PWA / Service Worker / Web Push 需要安全上下文（HTTPS 或 localhost）。手机通过局域网 IP 访问 dev server 属非安全上下文，需启用 HTTPS dev：

```bash
bun run dev:https    # 默认 bun run dev 走 HTTP（PC 开发无需 HTTPS）
```

`MOBI_DEV_HTTPS=1` 触发 [vite-plugin-mkcert](https://github.com/liuweiGL/vite-plugin-mkcert) 自动生成受信任证书（含 localhost + 当前所有局域网 IP），本机 IP 变化时重启自动重新生成。依赖系统已装 mkcert（macOS: `brew install mkcert`），PC 首次使用需 `mkcert -install` 安装根 CA。

### 手机安装 mkcert 根 CA（仅一次）

手机信任的是 mkcert 的**根 CA**（`rootCA.pem`），不是每次生成的服务端证书。装一次后永久有效，IP 变化 / 重启 dev / 换 WiFi 都不用再装。

**1. 获取根 CA 文件**

```bash
mkcert -CAROOT    # 打印根 CA 所在目录，里面有 rootCA.pem
```

**2. 传到手机**：AirDrop / 快传 / 邮件 / 或 dev 起来后用浏览器下载。

**3. Android 安装**

设置中搜索「证书」或「CA 证书」→ 从存储设备安装 → 选 `rootCA.pem`。

> 各厂商入口不同：原生 Android 在「安全和隐私 → 更多安全设置 → 加密与凭据」；三星在「生物识别和安全 → 其他安全设置」；小米在「密码与安全 → 系统安全」。务必装为「CA 证书」（不是 WiFi / VPN 证书）。

**4. iOS 安装**

- 下载 `rootCA.pem` → 设置 →「已下载描述文件」→ 安装
- 设置 → 通用 → 关于本机 → **证书信任设置** → 对该根证书启用完全信任

**5. 验证**

`bun run dev:https` 后，手机访问 vite 输出的 `https://<电脑IP>:5173`，地址栏显示 🔒 锁（无「不安全」警告）即信任成功。