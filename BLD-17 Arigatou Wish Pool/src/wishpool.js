/**
 * 阿里亚多许愿池｜愿望领域内核
 *
 * 设计依据：Notion《阿里亚多许愿池｜设计方案｜v0.2》+ Robin 2026-10-31 四项裁决。
 * 三条原则：
 *   1. 池子不判断愿望成没成：只有许愿者本人能改变愿望状态，系统没有任何自动转换。
 *   2. 愿望不能买：没有成功率，没有付费加次，每人每天一枚许愿币（念币）。
 *   3. 没有失败这个状态：愿望只会是 waiting（还在等）、fulfilled（成了）、released（放下了）。
 *
 * 本模块不依赖任何外部库，不做渲染，不做持久化。持久化层负责对 text 字段加密存储。
 */

export const WishState = Object.freeze({
  WAITING: 'waiting',
  FULFILLED: 'fulfilled',
  RELEASED: 'released',
});

export const WishMode = Object.freeze({
  SILENT: 'silent', // 在心里许：不记录任何内容
  WRITTEN: 'written', // 写下来：内容仅本人可见
});

export const CoinPolicy = Object.freeze({
  DAILY_FREE: 'daily-free', // 选项 A：念币，不进入经济（已确认）
  XINGYUAN: 'xingyuan', // 选项 B：最小面值星元，流入公共用途（保留可配，默认不用）
});

/** 「成了」的币公开层光强线性淡出年限：约 3 年从 1 → 0。系统不改 WishState，只改展示强度。 */
export const GLOW_FADE_YEARS = 3;

const MS_PER_YEAR = 365.25 * 86_400_000;

/**
 * 计算「成了」币的公开层光强（0–1）。
 * @param {Date|null|undefined} fulfilledAt
 * @param {Date} [now]
 * @param {number} [fadeYears]
 */
export function glowIntensity(fulfilledAt, now = new Date(), fadeYears = GLOW_FADE_YEARS) {
  if (!fulfilledAt) return 0;
  const years = (now.getTime() - fulfilledAt.getTime()) / MS_PER_YEAR;
  if (years <= 0) return 1;
  if (years >= fadeYears) return 0;
  return 1 - years / fadeYears;
}

export class WishPoolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WishPoolError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new WishPoolError(code, message);
};

export const MAX_TEXT_LENGTH = 500;

const defaultClock = () => new Date();

const defaultDayKey = (date) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

let fallbackCounter = 0;
const defaultIdGen = (prefix) => {
  const rand =
    globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${(fallbackCounter++).toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${rand}`;
};

/** actorId 形如 `kind:id`；kind 取冒号前一段。 */
const actorKind = (actorId) => {
  const i = actorId.indexOf(':');
  return i > 0 ? actorId.slice(0, i) : '';
};

/**
 * 创建一口许愿池。
 *
 * @param {object} [options]
 * @param {'daily-free'|'xingyuan'} [options.coinPolicy] 许愿币方案，默认选项 A 念币
 * @param {boolean} [options.allowRelease] 是否启用“放下”（已确认启用）
 * @param {boolean} [options.allowShareToHall] 是否允许本人主动把愿望带去远行者大厅（每次需显式确认）
 * @param {number} [options.glowFadeYears] 「成了」币光强线性淡出年限，默认 GLOW_FADE_YEARS
 * @param {() => Date} [options.clock]
 * @param {(date: Date) => string} [options.dayKey] “每人每天一枚”的日期划分
 * @param {(prefix: string) => string} [options.idGen]
 * @param {(actorId: string, amount: number) => boolean} [options.spend] 选项 B 下扣除星元的回调
 * @param {number} [options.xingyuanAmount] 选项 B 下每枚币的面值
 */
export function createWishPool(options = {}) {
  const {
    coinPolicy = CoinPolicy.DAILY_FREE,
    allowRelease = true,
    allowShareToHall = true,
    glowFadeYears = GLOW_FADE_YEARS,
    clock = defaultClock,
    dayKey = defaultDayKey,
    idGen = defaultIdGen,
    spend = null,
    xingyuanAmount = 1,
  } = options;

  if (!Object.values(CoinPolicy).includes(coinPolicy)) {
    fail('INVALID_POLICY', `未知的许愿币方案：${coinPolicy}`);
  }
  if (coinPolicy === CoinPolicy.XINGYUAN && typeof spend !== 'function') {
    fail('SPEND_REQUIRED', '星元方案需要提供 spend 回调。');
  }
  if (!(glowFadeYears > 0)) {
    fail('INVALID_POLICY', 'glowFadeYears 必须为正数。');
  }

  /** 已领取但未投出的币：token -> { owner, day } */
  const unspentCoins = new Map();
  /** 每人每天是否已领币：`${owner}|${day}` */
  const claimedDays = new Set();
  /** 愿望：coinId -> record。text 只存在这里，只在本人校验后读出。 */
  const wishes = new Map();
  /** 公开层渲染 id：coinId -> renderId。与 coinId 不同，不能反查本人。 */
  const renderIds = new Map();

  const requireActor = (actorId) => {
    if (typeof actorId !== 'string' || actorId.trim() === '') {
      fail('INVALID_ACTOR', '需要提供许愿者身份。');
    }
  };

  /** 仅居民可领币／许愿。actorId 形如 resident:…；访客／Root 等得 RESIDENT_ONLY。 */
  const requireResident = (actorId) => {
    requireActor(actorId);
    if (actorKind(actorId) !== 'resident') {
      fail('RESIDENT_ONLY', '只有居民可以领币许愿。');
    }
  };

  const requireOwnWish = (actorId, coinId) => {
    requireActor(actorId);
    const wish = wishes.get(coinId);
    // 不存在与不属于本人返回同一种错误，避免他人探测某枚币是否存在。
    if (!wish || wish.owner !== actorId) {
      fail('NOT_OWNER', '只有许愿者本人可以查看或改变这个愿望。');
    }
    return wish;
  };

  const toOwnerView = (coinId, wish) =>
    Object.freeze({
      coinId,
      mode: wish.mode,
      state: wish.state,
      text: wish.text,
      wishedAt: wish.wishedAt.toISOString(),
      settledAt: wish.settledAt ? wish.settledAt.toISOString() : null,
    });

  const requireWaiting = (wish) => {
    if (wish.state !== WishState.WAITING) {
      fail('INVALID_STATE', '这个愿望已经有了结局，不能再改变。');
    }
  };

  return Object.freeze({
    /** 领一枚许愿币。每人每天一枚，不可累积，不可转让。仅居民。 */
    claimCoin(actorId) {
      requireResident(actorId);
      const day = dayKey(clock());
      const key = `${actorId}|${day}`;
      if (claimedDays.has(key)) {
        fail('COIN_ALREADY_CLAIMED', '今天已经领过一枚了，明天再来。');
      }
      if (coinPolicy === CoinPolicy.XINGYUAN && spend(actorId, xingyuanAmount) !== true) {
        fail('SPEND_FAILED', '星元不足，未能取币。');
      }
      claimedDays.add(key);
      // 之前没投出的币作废，不累积。
      for (const [token, coin] of unspentCoins) {
        if (coin.owner === actorId) unspentCoins.delete(token);
      }
      const coinToken = idGen('coin');
      unspentCoins.set(coinToken, { owner: actorId, day });
      return Object.freeze({ coinToken });
    },

    /** 投币许愿。没有成功率，也没有回应。仅居民。 */
    makeWish(actorId, { coinToken, mode = WishMode.SILENT, text } = {}) {
      requireResident(actorId);
      const coin = unspentCoins.get(coinToken);
      if (!coin || coin.owner !== actorId) {
        fail('NO_COIN', '需要先领一枚自己的许愿币。');
      }
      if (coin.day !== dayKey(clock())) {
        unspentCoins.delete(coinToken);
        fail('NO_COIN', '这枚币已经过了当天，请重新领取。');
      }
      if (!Object.values(WishMode).includes(mode)) {
        fail('INVALID_MODE', `未知的许愿方式：${mode}`);
      }
      let storedText = null;
      if (mode === WishMode.WRITTEN) {
        if (typeof text !== 'string' || text.trim() === '') {
          fail('EMPTY_TEXT', '选择写下来时，需要写点什么；也可以改为在心里许。');
        }
        if (text.length > MAX_TEXT_LENGTH) {
          fail('TEXT_TOO_LONG', `愿望最多 ${MAX_TEXT_LENGTH} 字。`);
        }
        storedText = text;
      }
      unspentCoins.delete(coinToken);
      const coinId = idGen('wish');
      wishes.set(coinId, {
        owner: actorId,
        mode,
        text: storedText,
        state: WishState.WAITING,
        wishedAt: clock(),
        settledAt: null,
      });
      renderIds.set(coinId, idGen('ripple'));
      return Object.freeze({ coinId });
    },

    /** 说“阿里亚多”。只有本人可以，只能从“还在等”变为“成了”。 */
    thank(actorId, coinId) {
      const wish = requireOwnWish(actorId, coinId);
      requireWaiting(wish);
      wish.state = WishState.FULFILLED;
      wish.settledAt = clock();
      return toOwnerView(coinId, wish);
    },

    /** 放下。只有本人可以；写下的内容被真实删除，只留下日期。 */
    release(actorId, coinId) {
      if (!allowRelease) fail('RELEASE_DISABLED', '当前设定未启用“放下”。');
      const wish = requireOwnWish(actorId, coinId);
      requireWaiting(wish);
      wish.state = WishState.RELEASED;
      wish.settledAt = clock();
      wish.text = null;
      return toOwnerView(coinId, wish);
    },

    /** 本人查看自己的全部愿望。 */
    myWishes(actorId) {
      requireActor(actorId);
      const out = [];
      for (const [coinId, wish] of wishes) {
        if (wish.owner === actorId) out.push(toOwnerView(coinId, wish));
      }
      return Object.freeze(out);
    },

    /** 本人查看自己的一个愿望。 */
    myWish(actorId, coinId) {
      return toOwnerView(coinId, requireOwnWish(actorId, coinId));
    },

    /**
     * 公开层：任何人都只能看到池中的币，以及它们的光强。
     * 不含身份、不含内容、不含 coinId；放下的币已经化开，不再出现。
     * waiting → glow=0；fulfilled → glow 随 settledAt 距今线性淡出；系统不改 WishState。
     */
    publicView() {
      const now = clock();
      const coins = [];
      let waiting = 0;
      let glowing = 0;
      for (const [coinId, wish] of wishes) {
        if (wish.state === WishState.RELEASED) continue;
        const isFulfilled = wish.state === WishState.FULFILLED;
        const glow = isFulfilled ? glowIntensity(wish.settledAt, now, glowFadeYears) : 0;
        if (isFulfilled) glowing += 1;
        else waiting += 1;
        coins.push(
          Object.freeze({
            renderId: renderIds.get(coinId),
            glowing: isFulfilled,
            glow,
          }),
        );
      }
      // 打乱顺序，避免按投币先后推断是谁投的。
      for (let i = coins.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [coins[i], coins[j]] = [coins[j], coins[i]];
      }
      return Object.freeze({ inPool: waiting + glowing, waiting, glowing, coins: Object.freeze(coins) });
    },

    /**
     * 本人主动把一个写下的愿望带去 BLD-16 远行者大厅。
     * 只生成一份交给本人的草稿，不自动发布；每次都必须显式确认。
     */
    draftForTravelersHall(actorId, coinId, { confirm = false } = {}) {
      if (!allowShareToHall) fail('SHARE_DISABLED', '当前设定未启用带去远行者大厅。');
      const wish = requireOwnWish(actorId, coinId);
      if (confirm !== true) fail('CONFIRM_REQUIRED', '需要本人明确确认，才能生成草稿。');
      if (wish.mode !== WishMode.WRITTEN || wish.state !== WishState.WAITING) {
        fail('INVALID_STATE', '只有写下来、还在等的愿望可以带去远行者大厅。');
      }
      return Object.freeze({ author: actorId, summary: wish.text, source: 'arigatou-wish-pool', published: false });
    },
  });
}
