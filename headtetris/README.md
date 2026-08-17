# 抽丝方块 · 苏州第一丝厂

用头控制的俄罗斯方块。头动，方块不动——左右移动头让方块落位，歪头旋转，点头加速，张嘴砸落，全程无需手柄。画面以苏州第一丝厂缫丝车间为主题：红砖厂房、锯齿天窗、缫丝车剪影，方块是七色丝锭线轴，消行即「抽丝」，一根丝线被抽出飞向计分板。内置厂志彩蛋，升级时浮现丝厂百年故事。人脸识别与渲染全部在浏览器本地完成，不上传任何画面。

## 在线体验

https://dangsq.github.io/headtetris/

## 操作

| 动作 | 控制 |
|---|---|
| 左右移动头 | 方块跟随落位 |
| 歪头（>13°） | 旋转方块 |
| 点头 | 加速下落 |
| 张嘴 | 瞬间砸落 |
| 点击画面 | 开始 / 跳过收工画面 |

## 本地开发

```bash
npm install
npm run dev      # http://localhost:5173/
```

构建与部署（push 到 main 后 GitHub Actions 自动构建发布）：

```bash
npm run build
```

## 技术栈

- Vite + TypeScript + Canvas 2D
- MediaPipe FaceLandmarker（人脸关键点 + 表情系数，本地运行）
- getUserMedia 摄像头实时捕捉

## 目录结构

```
headtetris/
├── index.html           入口页
└── src/
    ├── main.ts          游戏循环 / 状态机 / 渲染
    ├── tetris.ts        俄罗斯方块核心逻辑
    ├── input.ts         头部控制（移头/歪头/点头/张嘴）
    ├── trackers.ts      MediaPipe 模型加载与坐标映射
    └── chronicle.ts     厂志彩蛋系统
```
