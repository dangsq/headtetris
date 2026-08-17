# 抽丝方块

加班到深夜，屏幕泛起一缕蚕丝微光——再抬眼，我已站在 1926 年姑苏南门的缫丝车间里。工头递来丝锭：今夜轮你抽丝。没有键盘也没有手柄，你的头，就是引线。

左右移头，丝锭落位；歪头转身；点头下沉；张嘴瞬间坠入丝筐。一行丝锭排满，便化一缕白厂丝被抽出棋盘，飞入账房的计丝本。抽得越多，丝车转得越急——别让丝锭堆到天窗，那意味着今日收工，明日再来。

你的脸，就是引线。人脸识别与渲染全部在浏览器本地完成，画面只属于你自己，不曾离开过这台机器。

## 入厂

https://dangsq.github.io/headtetris/

## 身法

| 动作 | 控制 |
|---|---|
| 左右移头 | 丝锭随头落位 |
| 歪头 | 丝锭转身 |
| 点头 | 加速下沉 |
| 张嘴 | 瞬间砸落 |
| 点击画面 | 开场 / 收工可跳过 |

## 开工

```bash
npm install
npm run dev      # 本地试机 http://localhost:5173/
npm run build    # 出绸（构建产物在 dist/）
```

推送 `main` 分支，GitHub Actions 自动缫丝成绸、发布上线。

## 织机

- Vite + TypeScript + Canvas 2D
- MediaPipe FaceLandmarker —— 面部关键点与表情系数，本地运转
- getUserMedia —— 摄像头实时入画

## 机房

```
headtetris/
├── index.html           厂门
└── src/
    ├── main.ts          班次轮转：游戏循环 / 状态机 / 渲染
    ├── tetris.ts        织造之道：方块核心逻辑
    ├── input.ts         身法门：移头 / 歪头 / 点头 / 张嘴
    ├── trackers.ts      缫丝机：MediaPipe 加载与坐标映射
    └── chronicle.ts     厂志：百年故事，织入棋局
```
