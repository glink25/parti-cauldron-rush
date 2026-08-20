# Cauldron Rush — Parti Room

原创炼金 push-your-luck 多人游戏，2–5 人、7 轮。玩家同时从自己的袋中抽取筹码推进锅轨，白色危险值超过 7 会爆锅；每轮根据锅位获得 VP / 金币并购买新筹码。

## 开发

```bash
npm install
npm run dev
npm run build:vite
```

仓库同时提供 `npm run build` 的零依赖本地验证构建脚本（仅依赖系统 TypeScript），用于受限环境检查最终 Parti 包结构。正式开发与发布优先使用 `npm run build:vite`。

## 验证

```bash
npm run typecheck
npm test
npm run build
grep "@parti/worker-sdk" dist/room.worker.js
grep "defineRoom" dist/room.worker.js
```

最终包入口：`dist/parti.room.json`、`dist/index.html`、`dist/room.worker.js`。

## MVP 规则

- 2–5 人，7 轮。
- White 危险总值 `> 7` 爆锅；正好 7 安全。
- Green：若位于本轮最后两枚非白筹码之一，结算 +1 ruby。
- Red：锅中已有至少 2 枚 Red 时，新 Red 额外前进 1。
- Blue：触发双候选，选 1 入锅、另 1 放回袋。
- 未爆锅：拿 VP 且可购物；爆锅：VP / 购物二选一。
- 每轮最多买 2 枚且颜色不同。
- 2 ruby 可永久起点 +1（最多 +5）或补充 Flask。
- 7 轮后 VP 最高者获胜；平手比较袋中非白筹码总价值，再平则共享胜利。
