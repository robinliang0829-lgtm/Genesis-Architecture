# 阿里亚多许愿池｜Genesis Architecture

> 投个币，许个愿，不一定包成，万一成了，说句阿里亚多就好

创世岛 BLD-05 枢纽中心门前的核心景观造物。出发时许愿，归来时致谢。

- 设定页：Notion《阿里亚多许愿池｜枢纽中心前核心造物｜v0.1｜设定确认》
- 设计方案：Notion《阿里亚多许愿池｜设计方案｜v0.2｜提案待确认》
- 项目跟踪：PM-001 第 45 项「核心造物」，关联第 41 项 Landscape、第 47 项 Sound、第 07 项 Memory、第 05 项权限

**状态：** 原型。Robin 2026-10-31 四项裁决已确认并写入内核（念币、放下、仅居民、成了币约 3 年线性淡出）；不变量测试与可视化原型可交互。3D 模型、Landscape 落位、持久化与正式 Resident 接入均未开始。见 `docs/DESIGN.md`。

## 目录

```
src/wishpool.js          愿望领域内核：无依赖，不渲染，不持久化
test/wishpool.test.js    不变量测试（node:test）
prototype/index.html     交互原型（Canvas 2D）
prototype/app.js         原型逻辑，直接调用领域内核
prototype/standalone.html 单文件版原型，可直接双击打开
scripts/build-standalone.mjs 生成单文件版
docs/DESIGN.md           设计原则、默认取值与待裁决项
```

## 运行

需要 Node.js 20 或以上，没有任何第三方依赖。

```bash
npm test                  # 运行全部不变量测试
npm run build:standalone  # 重新生成 prototype/standalone.html
npm run prototype         # 在 8080 端口启动静态服务，打开 /prototype/
```

不想启动服务时，直接用浏览器打开 `prototype/standalone.html`。

## 三条原则，以及它们在代码里的样子

**池子不判断愿望成没成。** 只有许愿者本人能调用 `thank` 和 `release`；Root 与任何其他身份都会得到 `NOT_OWNER`。内核没有任何按时间或条件自动改变愿望状态的代码路径。

**愿望不能买。** 每人每天只能 `claimCoin` 一次（念币），币不可转让、不可累积；没有成功率字段，也没有付费加次的接口。仅居民可领币／许愿（访客／Root 得 `RESIDENT_ONLY`）。

**没有失败这个状态。** `WishState` 只有 `waiting`、`fulfilled`、`released` 三种，后两种都是终局。

## 隐私

- 「在心里许」不记录任何内容，即使调用方传入了文字。
- 「写下来」的内容只能由本人读出；放下后被真实删除，只留下日期。
- `publicView()` 只返回计数和 `{ renderId, glowing, glow }`（`glow` 为 0–1 光强）。`renderId` 与 `coinId` 不同，顺序随机打乱，无法反查是谁投的。
- 查询不存在的币与查询别人的币返回同一种错误，无法探测某枚币是否存在。
- 带去远行者大厅只生成交给本人的草稿，`published: false`，每次需显式确认。

**持久化层的责任：** 内核把 `text` 保存在内存中。接入正式存储时，`text` 必须按私人记忆的标准加密，且遵守公共治理方案已确认的令状制度。

## 推送到 GitHub

本目录已初始化为 Git 仓库，并有一个初始提交。在 GitHub 新建一个空的私有仓库后：

```bash
git remote add origin git@github.com:<你的账号>/Genesis-Architecture-Arigatou-Wish-Pool.git
git push -u origin main
```
