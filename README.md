# 亲亲 · 家人相框

一个可直接放进 GitHub Pages 的 plain HTML / CSS / JS 交互 demo：家人从手机发送照片和文字，老人相框端查看、朗读、录音回复，并通过固定联系人发起演示通话。

## 预览

```bash
cd qinqin-family-frame
python3 -m http.server 4173
```

打开 http://localhost:4173/ 。也可以直接打开 `index.html`，但使用本地服务器更接近 GitHub Pages 的行为。

## 这版可以做什么

- 在“奶奶的相框 / 家人的手机 / 双端同屏”之间切换。
- 用底部实体键上一张、下一张、朗读当前照片描述，或打开双向文字和录音留言。
- 手机端选择照片后会在浏览器里压缩到最长边 1280px、JPEG 质量约 78%，再发送到相框端。
- 三个固定联系人可打开明确标注的“演示通话”弹层：接听、挂断、转留言均可点击，不会拨出真实电话。
- 浏览器支持 `SpeechRecognition` 时可直接说“下一张”“再听一遍”“给孙子打电话”；不支持时会显示可点击的示例语句。
- 使用 `localStorage` 保存本 demo 的照片、文字和当前状态；使用 `BroadcastChannel` / `storage` 让同一浏览器的两个标签页互相更新。
- “清除此演示数据”只移除 `qinqin-family-frame:v1` 这个键，不会清空浏览器其他数据。

## 局限

这是本机交互演示，没有账号、云端同步、真实通话、推送服务或后端。录音需要浏览器麦克风权限；如果浏览器不支持或用户拒绝，会保留可用的文字留言流程。录音、文字和照片会尝试持久化到本机，实际可保存时长受浏览器存储额度影响。

页面使用深蓝相框外壳、阳光黄实体键和珊瑚色留言标记，移动端适配约 390px 宽度，支持键盘聚焦与减少动画设置。

## 素材来源

示例图片来自 Unsplash 的公开图片链接，下载为本地演示素材，便于 GitHub Pages 使用：

- `family-living.jpg` — https://images.unsplash.com/photo-1511895426328-dc8714191300?w=1200&q=82&auto=format&fit=crop
- `child-garden.jpg` — https://images.unsplash.com/photo-1472162072942-cd5147eb3902?w=1200&q=82&auto=format&fit=crop
- `family-table.jpg` — https://images.unsplash.com/photo-1494386346843-e12284507169?w=1200&q=82&auto=format&fit=crop
- `flowers.jpg` — https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=1200&q=82&auto=format&fit=crop

照片仅作为公开演示素材，不包含用户私人图片。
