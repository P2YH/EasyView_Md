# EasyView HTML 预览发布

EasyView 相关 HTML（宣传片、官网页面、说明页等）统一用 [surge.sh](https://surge.sh) 发布为可打开的预览链接。迭代期不要用其他预览方式（例如仅 localhost、仅本地文件路径、或非 surge 的临时托管）。

## 账号与凭证

- 账号：`dina.wonderxy+surge@mail.grokbot.com`
- 凭证：Grok Bot box 上的 `~/secrets/surge.txt`（用户本机不持有该账号密码）

## 发布步骤

1. 将自包含 HTML 及同目录资源放到一个目录（例如 `dist-preview/`）。
2. 在 box 上登录并发布，例如：

```bash
npx surge ./该目录 自定义名.surge.sh
```

3. 把得到的 `https://自定义名.surge.sh/` 链接发给需要预览的人（聊天 / 手机可直接打开）。

## 已有预览示例

- 立体书宣传片：https://easyview-popup-44b090.surge.sh/
- 火柴人宣传片：https://easyview-ronin-7c31.surge.sh/

定稿后再导出视频；迭代阶段以脚本 → HTML → 重新 surge 发布 → 发预览链接为准。
