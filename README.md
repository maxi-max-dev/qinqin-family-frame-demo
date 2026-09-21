# UNSEEN Frame

一个打开就能玩的家庭相框交互演示。默认进入老人相框，示例照片、人物头像和留言已经准备好；切到“家属手机”可以选本机照片、写留言，或回到相框查看回复。

## 本地运行

```bash
python3 -m http.server 4173
```

打开 <http://localhost:4173/>。这是 plain HTML / CSS / JS，不需要 npm 依赖或构建步骤。

## 可以体验什么

- 老人相框：大照片、上一张 / 留言 / 下一张、设备朗读、语音找人和大号联系人按钮。
- 家属手机：选择本机照片、压缩后发送、关联当前照片写留言；相框回复会回到手机端。
- 提醒状态：黄色代表新照片，蓝色代表新留言，绿色代表模拟来电，优先级为来电 > 留言 > 照片。
- 演示工具：触发新照片、新留言、模拟来电、同屏查看两端或重置演示。
- 回复支持文字和本机录音；浏览器不支持麦克风时仍可直接写字。
- 两个同源标签页通过 `localStorage` / `BroadcastChannel` 同步本机演示数据，所有留言带 `photoId` 关联照片。
- “登录家庭”进入站内 `family.html`，连接显式配置的 UNSEEN 后端；无需登录的本机演示保留在 `index.html`。

## 独立家庭账号版

本分支新增站内 `family.html`。它使用现有 UNSEEN 用户名登录、私有 Space、正式成员权限、照片上传和照片留言接口；网页演示仍由 `index.html` 提供。本分支不会修改 UNSEEN 主产品的代码、数据库结构或现有部署。

使用 Node 启动独立服务：

```bash
PORT=4620 node server.mjs
```

默认仅监听 `127.0.0.1` 并提供静态页面，不连接任何后端。要连接已明确选择的测试后端，必须显式设置以下环境变量：

```bash
PORT=4620 \
FRAME_PUBLIC_ORIGIN=http://127.0.0.1:4620 \
FRAME_ENABLE_CANONICAL_PROXY=1 \
CANONICAL_UPSTREAM=http://127.0.0.1:4790 \
CANONICAL_PUBLIC_ORIGIN=http://127.0.0.1:4790 \
node server.mjs
```

随后打开 <http://127.0.0.1:4620/family.html>。测试后端需单独启动；端口只是本地配置示例，不会自动生成账号或家庭。账号密码不得写入公共源码。家庭成员必须已有正式权限，仅创建用户名不会自动建立家庭关系。

独立服务验证原始请求来源，再规范后端所需的 Host/Origin；只代理相框所需接口，保留 host-only 登录 cookie。相同账号可分别登录两个域名，未实现跨域自动登录。`ops/` 内的服务和 Caddy 文件是部署候选，不能视作已经上线的证据。

定向检查：`node --test test/*.test.mjs`。

## 诚实边界

`index.html` 是 UNSEEN Frame 的本机演示模式。示例照片、人物、提醒和通话都只是演示内容；通话弹层明确标注不会拨出真实电话，语音朗读明确使用当前设备。该模式的上传照片、文字、录音和已读状态只保存在当前浏览器，清除演示会移除 `unseen-frame-demo:v1`。`family.html` 登录版的照片和留言由所连接的 UNSEEN 后端保存，浏览器仅记住按账号隔离的家庭选择、视角和已读标记。

页面使用本地 `assets/` 素材，不依赖外链图片或付费服务，并支持键盘聚焦与 `prefers-reduced-motion`。

## 演示素材来源

以下图片来自 Unsplash，沿用原演示的公开素材，不包含用户私人照片：

- `family-living.jpg` — https://images.unsplash.com/photo-1511895426328-dc8714191300?w=1200&q=82&auto=format&fit=crop
- `child-garden.jpg` — https://images.unsplash.com/photo-1472162072942-cd5147eb3902?w=1200&q=82&auto=format&fit=crop
- `family-table.jpg` — https://images.unsplash.com/photo-1494386346843-e12284507169?w=1200&q=82&auto=format&fit=crop
- `flowers.jpg` — https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=1200&q=82&auto=format&fit=crop
- `avatar-grandson.jpg` — https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=256&q=85&auto=format&fit=crop&crop=faces
- `avatar-daughter.jpg` — https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=256&q=85&auto=format&fit=crop&crop=faces
- `avatar-granddaughter.jpg` — https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=256&q=85&auto=format&fit=crop&crop=faces
