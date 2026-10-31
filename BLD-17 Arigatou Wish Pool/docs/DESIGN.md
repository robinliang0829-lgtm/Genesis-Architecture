# 设计说明

完整设计方案以 Notion《阿里亚多许愿池｜设计方案｜v0.2》为准，本文件记录代码实现所依据的部分，以及 **Robin 2026-10-31 四项裁决**（已锁定）。

## 一个愿望的一生

| 状态 | 含义 | 谁能进入 | 是否终局 |
| --- | --- | --- | --- |
| `waiting` | 还在等 | 投币后自动进入 | 否，可以一直停在这里 |
| `fulfilled` | 成了 | 只有本人说“阿里亚多” | 是 |
| `released` | 放下了 | 只有本人选择放下 | 是 |

## Robin 2026-10-31 已确认裁决

| 项 | 裁决 | 代码落实 |
| --- | --- | --- |
| 许愿币 | 选项 A：念币，每人每天一枚，不进经济 | 默认 `coinPolicy: 'daily-free'` |
| 「放下」结局 | 增加放下 | 默认 `allowRelease: true`；`release` 删内容、只留日期 |
| 谁可许愿 | **仅居民**；外来 IP 访客不可 | `claimCoin`／`makeWish` 要求 `actorId` 形如 `resident:…`，否则 `RESIDENT_ONLY` |
| 「成了」夜里怎么亮 | 成了的币会随年月**慢慢变暗**（非永远常亮） | `publicView()` 增加 `glow`（0–1）；见下方淡出公式 |

### 「成了」币光强淡出

- 常量：`GLOW_FADE_YEARS = 3`（可经 `createWishPool({ glowFadeYears })` 覆盖）。
- 公式（线性）：`glow = clamp(1 - yearsSince(fulfilledAt) / GLOW_FADE_YEARS, 0, 1)`，其中一年按 `365.25` 日。
- `waiting` → `glow = 0`；`released` 不出现在公开层；`fulfilled` 即使 `glow = 0` 仍在池中（`glowing: true`），只是暗了。
- **系统不自动改 `WishState`**，只改展示强度。

## 配置项

| 项 | 默认 | 配置 |
| --- | --- | --- |
| 许愿币方案 | 念币（已确认） | `coinPolicy: 'daily-free'` 或 `'xingyuan'` |
| 放下 | 启用（已确认） | `allowRelease` |
| 带去远行者大厅 | 启用，每次本人确认，只生成草稿 | `allowShareToHall` |
| 光强淡出年限 | 3 年线性 1→0 | `glowFadeYears` |

“每天”默认按 UTC 日期划分，可用 `dayKey` 改为创世岛的世界时间。

`actorId` 约定：`kind:id`（冒号前为身份种类）。领币／许愿仅接受 `kind === 'resident'`。Root／访客 thank／release 非本人愿望仍得 `NOT_OWNER`。

## 不做的事

不做抽卡、概率、幸运值或灵验度；不做付费加次、排行榜或许愿数量成就；不设 NPC 或系统代为宣布愿望实现；不推送“回来还愿”的提醒；不把愿望内容用于推荐、画像或任何模型训练。

## 与其他系统的接口（尚未实现）

- **Memory（第 07 项）：** Resident 许下的愿望是它的亲历，应写入它自己的私人记忆并标明来源；记忆系统不得推断“这个愿望似乎成了”。
- **权限（第 05 项）：** 正式接入时，`actorId` 必须来自已验证的身份，不能由客户端自报。
- **Sound（第 47 项）：** 投币的轻响、致谢的一声铃；许愿内容不进入空间音频。
- **Landscape（第 41 项）：** 落位须保留枢纽入口、人行主路、无障碍通道与铁路安全净空。

## 实现进度（相对裁决）

- [x] 四项裁决写入内核／测试／本说明
- [x] 「成了」币 `glow` 淡出
- [ ] 3D 模型
- [ ] Landscape 落位
- [ ] 持久化
- [ ] Resident 正式接入
