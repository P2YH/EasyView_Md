# EasyView_Md

EasyView_Md 桌面版是该项目的 Electron APP，与 VS Code 插件共享 `@easyview/editor-core` 编辑器内核。

桌面端 `icon.png`、`icon.icns`、`icon.ico` 由仓库公共品牌源 `resources/brand/logo.png` 生成，使用 `npm run generate:brand-icons` 更新。

## 开发

```bash
npm install
npm run start --workspace @easyview/desktop
```

## 验证

```bash
npm run typecheck --workspace @easyview/desktop
npm run test:e2e:desktop
```

## 构建

```bash
npm run package:desktop
npm run make:desktop
```

macOS 额外生成 DMG：

```bash
npm run make:dmg --workspace @easyview/desktop
```

Windows 安装包（NSIS 安装向导）在 Forge `make` 之后生成，只能在 Windows 上打：

```bash
npm run make:nsis --workspace @easyview/desktop
```

`scripts/make-nsis.mjs` 用 electron-builder（配置 `electron-builder.nsis.cjs`）把 Forge 产物 `out/EasyView_Md-win32-x64` 打成 `out/nsis/EasyView_Md-win-x64-setup.exe`。向导可选“仅为我安装”（无需管理员）或“为所有用户安装”（需管理员），并可修改安装目录。安装时把 EasyView_Md 加入 `.md` / `.markdown` / `.mdx` 的“打开方式”列表（`build/installer.nsh`），不改默认打开程序。macOS 生成 ZIP，并通过系统 `hdiutil` 生成 DMG。

## 安全边界

- Renderer 不启用 Node.js Integration。
- Main、Preload、Renderer 使用明确分层。
- Renderer 只能通过 Preload 暴露的受控接口访问文件和系统能力。
- 外部导航、新窗口和外部链接协议均受到限制。
