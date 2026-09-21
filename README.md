# 亲亲 · 家人相框

一个可直接放进 GitHub Pages 的 plain HTML / CSS / JS 交互 demo：家人从手机发送照片和文字，老人相框端查看、朗读、录音回复，并通过固定联系人发起演示通话。老人首页只保留照片、固定的大按钮和一句明确提醒。

## 预览

```bash
cd qinqin-family-frame
python3 -m http.server 4173
```

打开 http://localhost:4173/ 。也可以直接打开 `index.html`，但使用本地服务器更接近 GitHub Pages 的行为。

## 这版可以做什么

- 在“奶奶的相框 / 家人的手机 / 双端同屏”之间切换。
- 相框外沿会用连续柔和灯圈和大字提醒状态：暖黄=新照片，蓝色=新留言，绿色=演示来电；状态按“来电 > 留言 > 照片”优先显示，点确认后熄灭并恢复下一条提醒。首次打开默认有一张未看照片。
- 点右上角“试试提醒”可分别触发新照片、新留言、来电，演示事件会写进本机状态并可完成确认循环。
- 用底部实体键上一张、下一张、朗读当前照片描述，或打开双向文字和录音留言。
- 手机端选择照片后会在浏览器里压缩到最长边 1280px、JPEG 质量约 78%，再发送到相框端。
- 三个固定联系人可打开明确标注的“演示通话”弹层：接听、挂断、转留言均可点击，不会拨出真实电话。
- 家人手机端可以直接写一句话发给奶奶；相框回复和家人留言都会保留收发方向，并在有对应照片时显示照片缩略图和说明。
- 浏览器支持 `SpeechRecognition` 时可直接说“下一张”“再听一遍”“给孙子打电话”；不支持时会显示可点击的示例语句。
- 使用 `localStorage` 保存本 demo 的照片、文字和当前状态；使用 `BroadcastChannel` / `storage` 让同一浏览器的两个标签页互相更新。
- 从旧版 `qinqin-family-frame:v1` 读取照片和留言并补齐状态字段；无状态的旧照片沿用首张作为待处理示例。新上传照片和新留言会触发对应提醒。
- “清除此演示数据”只移除 `qinqin-family-frame:v1` 这个键，不会清空浏览器其他数据。

## 局限

这是本机交互演示，没有账号、云端同步、真实通话、推送服务或后端。录音需要浏览器麦克风权限；如果浏览器不支持或用户拒绝，会保留可用的文字留言流程。录音、文字和照片会尝试持久化到本机，实际可保存时长受浏览器存储额度影响。

页面使用深蓝相框外壳、阳光黄实体键和珊瑚色留言标记，移动端适配约 390px 宽度，支持键盘聚焦与减少动画设置。示例联系人使用本地真实照片头像；所有数据只在本机，通话明确是演示模拟。

## 素材来源

示例图片来自 Unsplash 的公开图片链接，下载为本地演示素材，便于 GitHub Pages 使用：

- `family-living.jpg` — https://images.unsplash.com/photo-1511895426328-dc8714191300?w=1200&q=82&auto=format&fit=crop
- `child-garden.jpg` — https://images.unsplash.com/photo-1472162072942-cd5147eb3902?w=1200&q=82&auto=format&fit=crop
- `family-table.jpg` — https://images.unsplash.com/photo-1494386346843-e12284507169?w=1200&q=82&auto=format&fit=crop
- `flowers.jpg` — https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=1200&q=82&auto=format&fit=crop

照片仅作为公开演示素材，不包含用户私人图片。

联系人头像也使用本地公开演示素材：

- `avatar-grandson.jpg` — https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=256&q=85&auto=format&fit=crop&crop=faces
- `avatar-daughter.jpg` — https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=256&q=85&auto=format&fit=crop&crop=faces
- `avatar-granddaughter.jpg` — https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=256&q=85&auto=format&fit=crop&crop=faces
