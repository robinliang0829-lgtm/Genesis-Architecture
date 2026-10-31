import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWishPool,
  WishState,
  WishMode,
  CoinPolicy,
  MAX_TEXT_LENGTH,
  GLOW_FADE_YEARS,
  glowIntensity,
} from '../src/wishpool.js';

/** 可控时钟，便于验证“时间流逝不会改变任何愿望”。 */
const fakeClock = (iso = '2026-10-25T08:00:00Z') => {
  let now = new Date(iso);
  return {
    clock: () => new Date(now),
    advanceDays: (n) => {
      now = new Date(now.getTime() + n * 86_400_000);
    },
  };
};

const ROBIN = 'resident:robin';
const OTHER = 'resident:other';
const ROOT = 'root:000';
const VISITOR = 'visitor:guest';

const wishOnce = (pool, actor, opts = {}) => {
  const { coinToken } = pool.claimCoin(actor);
  return pool.makeWish(actor, { coinToken, ...opts }).coinId;
};

const expectCode = (fn, code) => assert.throws(fn, (err) => err.code === code);

describe('原则一：池子不判断愿望成没成', () => {
  test('只有本人能说阿里亚多；他人与 Root 均被拒绝', () => {
    const pool = createWishPool();
    const id = wishOnce(pool, ROBIN);
    expectCode(() => pool.thank(OTHER, id), 'NOT_OWNER');
    expectCode(() => pool.thank(ROOT, id), 'NOT_OWNER');
    assert.equal(pool.thank(ROBIN, id).state, WishState.FULFILLED);
  });

  test('只有本人能放下；他人与 Root 均被拒绝', () => {
    const pool = createWishPool();
    const id = wishOnce(pool, ROBIN);
    expectCode(() => pool.release(OTHER, id), 'NOT_OWNER');
    expectCode(() => pool.release(ROOT, id), 'NOT_OWNER');
    assert.equal(pool.release(ROBIN, id).state, WishState.RELEASED);
  });

  test('时间流逝不会自动改变任何愿望', () => {
    const t = fakeClock();
    const pool = createWishPool({ clock: t.clock });
    const id = wishOnce(pool, ROBIN);
    t.advanceDays(365 * 100);
    assert.equal(pool.myWish(ROBIN, id).state, WishState.WAITING);
  });

  test('公开接口中不存在改变状态的方法', () => {
    const pool = createWishPool();
    const methods = Object.keys(pool).sort();
    assert.deepEqual(methods, [
      'claimCoin',
      'draftForTravelersHall',
      'makeWish',
      'myWish',
      'myWishes',
      'publicView',
      'release',
      'thank',
    ]);
    assert.ok(Object.isFrozen(pool));
  });

  test('他人查询不存在与不属于自己的币，得到同一种错误，无法探测', () => {
    const pool = createWishPool();
    const id = wishOnce(pool, ROBIN);
    const a = assert.throws(() => pool.myWish(OTHER, id), (e) => e.code === 'NOT_OWNER');
    const b = assert.throws(() => pool.myWish(OTHER, 'wish_does_not_exist'), (e) => e.code === 'NOT_OWNER');
    assert.equal(a, b);
  });
});

describe('原则二：愿望不能买', () => {
  test('每人每天一枚；同一天第二次领取被拒绝，第二天可以再领', () => {
    const t = fakeClock();
    const pool = createWishPool({ clock: t.clock });
    pool.claimCoin(ROBIN);
    expectCode(() => pool.claimCoin(ROBIN), 'COIN_ALREADY_CLAIMED');
    t.advanceDays(1);
    assert.ok(pool.claimCoin(ROBIN).coinToken);
  });

  test('币不可转让：他人不能用我的币许愿', () => {
    const pool = createWishPool();
    const { coinToken } = pool.claimCoin(ROBIN);
    expectCode(() => pool.makeWish(OTHER, { coinToken }), 'NO_COIN');
  });

  test('币不可累积：当天没投出的币，第二天作废', () => {
    const t = fakeClock();
    const pool = createWishPool({ clock: t.clock });
    const { coinToken } = pool.claimCoin(ROBIN);
    t.advanceDays(1);
    expectCode(() => pool.makeWish(ROBIN, { coinToken }), 'NO_COIN');
  });

  test('一枚币只能投一次', () => {
    const pool = createWishPool();
    const { coinToken } = pool.claimCoin(ROBIN);
    pool.makeWish(ROBIN, { coinToken });
    expectCode(() => pool.makeWish(ROBIN, { coinToken }), 'NO_COIN');
  });

  test('选项 B：星元不足时不能取币，且每天仍只有一枚', () => {
    const t = fakeClock();
    const balance = { [ROBIN]: 1 };
    const spend = (actor, amount) => {
      if ((balance[actor] ?? 0) < amount) return false;
      balance[actor] -= amount;
      return true;
    };
    const pool = createWishPool({ coinPolicy: CoinPolicy.XINGYUAN, spend, clock: t.clock });
    pool.claimCoin(ROBIN);
    assert.equal(balance[ROBIN], 0);
    expectCode(() => pool.claimCoin(ROBIN), 'COIN_ALREADY_CLAIMED');
    t.advanceDays(1);
    expectCode(() => pool.claimCoin(ROBIN), 'SPEND_FAILED');
  });

  test('选项 B 必须提供扣费回调', () => {
    expectCode(() => createWishPool({ coinPolicy: CoinPolicy.XINGYUAN }), 'SPEND_REQUIRED');
  });
});

describe('原则三：没有失败这个状态', () => {
  test('愿望只有三种状态', () => {
    assert.deepEqual(Object.values(WishState).sort(), ['fulfilled', 'released', 'waiting']);
  });

  test('成了与放下都是终局，不能互相转换，也不能重复', () => {
    const pool = createWishPool();
    const a = wishOnce(pool, ROBIN);
    pool.thank(ROBIN, a);
    expectCode(() => pool.thank(ROBIN, a), 'INVALID_STATE');
    expectCode(() => pool.release(ROBIN, a), 'INVALID_STATE');

    const pool2 = createWishPool();
    const b = wishOnce(pool2, ROBIN);
    pool2.release(ROBIN, b);
    expectCode(() => pool2.thank(ROBIN, b), 'INVALID_STATE');
    expectCode(() => pool2.release(ROBIN, b), 'INVALID_STATE');
  });

  test('可关闭“放下”这种结局', () => {
    const pool = createWishPool({ allowRelease: false });
    const id = wishOnce(pool, ROBIN);
    expectCode(() => pool.release(ROBIN, id), 'RELEASE_DISABLED');
  });
});

describe('隐私', () => {
  test('在心里许：不记录任何内容，即使传入文字', () => {
    const pool = createWishPool();
    const id = wishOnce(pool, ROBIN, { mode: WishMode.SILENT, text: '不该被记下的话' });
    assert.equal(pool.myWish(ROBIN, id).text, null);
  });

  test('写下来：只有本人能读到内容', () => {
    const pool = createWishPool();
    const id = wishOnce(pool, ROBIN, { mode: WishMode.WRITTEN, text: '希望渡平安回来' });
    assert.equal(pool.myWish(ROBIN, id).text, '希望渡平安回来');
    expectCode(() => pool.myWish(OTHER, id), 'NOT_OWNER');
    assert.equal(pool.myWishes(OTHER).length, 0);
  });

  test('放下后内容被真实删除，只留下日期', () => {
    const pool = createWishPool();
    const id = wishOnce(pool, ROBIN, { mode: WishMode.WRITTEN, text: '一个会被放下的愿望' });
    const view = pool.release(ROBIN, id);
    assert.equal(view.text, null);
    assert.equal(pool.myWish(ROBIN, id).text, null);
    assert.ok(view.wishedAt && view.settledAt);
  });

  test('公开层不含身份、内容或 coinId', () => {
    const pool = createWishPool();
    const id = wishOnce(pool, ROBIN, { mode: WishMode.WRITTEN, text: '秘密' });
    pool.thank(ROBIN, id);
    const view = pool.publicView();
    const serialized = JSON.stringify(view);
    assert.ok(!serialized.includes(ROBIN));
    assert.ok(!serialized.includes('秘密'));
    assert.ok(!serialized.includes(id));
    for (const coin of view.coins) assert.deepEqual(Object.keys(coin).sort(), ['glow', 'glowing', 'renderId']);
  });

  test('公开层计数正确；放下的币不再出现在池中', () => {
    const t = fakeClock();
    const pool = createWishPool({ clock: t.clock });
    const a = wishOnce(pool, ROBIN);
    const b = wishOnce(pool, OTHER);
    t.advanceDays(1);
    const c = wishOnce(pool, ROBIN);
    pool.thank(ROBIN, a);
    pool.release(OTHER, b);
    const view = pool.publicView();
    assert.equal(view.inPool, 2);
    assert.equal(view.glowing, 1);
    assert.equal(view.waiting, 1);
    assert.equal(pool.myWish(ROBIN, c).state, WishState.WAITING);
  });

  test('写下来时必须有内容，且有长度上限', () => {
    const pool = createWishPool();
    const t1 = pool.claimCoin(ROBIN).coinToken;
    expectCode(() => pool.makeWish(ROBIN, { coinToken: t1, mode: WishMode.WRITTEN, text: '   ' }), 'EMPTY_TEXT');
    expectCode(
      () => pool.makeWish(ROBIN, { coinToken: t1, mode: WishMode.WRITTEN, text: 'a'.repeat(MAX_TEXT_LENGTH + 1) }),
      'TEXT_TOO_LONG',
    );
  });
});

describe('带去远行者大厅：默认不发生，只由本人每次确认', () => {
  test('未确认时拒绝；确认后只生成草稿，不自动发布', () => {
    const pool = createWishPool();
    const id = wishOnce(pool, ROBIN, { mode: WishMode.WRITTEN, text: '想找人一起修风车' });
    expectCode(() => pool.draftForTravelersHall(ROBIN, id), 'CONFIRM_REQUIRED');
    const draft = pool.draftForTravelersHall(ROBIN, id, { confirm: true });
    assert.equal(draft.published, false);
    assert.equal(draft.summary, '想找人一起修风车');
  });

  test('他人不能替我生成；在心里许的愿望不能带去', () => {
    const pool = createWishPool();
    const written = wishOnce(pool, ROBIN, { mode: WishMode.WRITTEN, text: '写下的' });
    expectCode(() => pool.draftForTravelersHall(OTHER, written, { confirm: true }), 'NOT_OWNER');
    const pool2 = createWishPool();
    const silent = wishOnce(pool2, ROBIN);
    expectCode(() => pool2.draftForTravelersHall(ROBIN, silent, { confirm: true }), 'INVALID_STATE');
  });
});

describe('仅居民可许愿（Robin 2026-10-31）', () => {
  test('访客不能领币也不能许愿', () => {
    const pool = createWishPool();
    expectCode(() => pool.claimCoin(VISITOR), 'RESIDENT_ONLY');
    expectCode(() => pool.makeWish(VISITOR, { coinToken: 'coin_x' }), 'RESIDENT_ONLY');
  });

  test('Root 不能领币／许愿；也不能 thank／release 他人愿望', () => {
    const pool = createWishPool();
    expectCode(() => pool.claimCoin(ROOT), 'RESIDENT_ONLY');
    const id = wishOnce(pool, ROBIN);
    expectCode(() => pool.thank(ROOT, id), 'NOT_OWNER');
    expectCode(() => pool.release(ROOT, id), 'NOT_OWNER');
  });

  test('居民本人 thank／release 成功', () => {
    const t = fakeClock();
    const pool = createWishPool({ clock: t.clock });
    const a = wishOnce(pool, ROBIN);
    assert.equal(pool.thank(ROBIN, a).state, WishState.FULFILLED);
    t.advanceDays(1);
    const b = wishOnce(pool, ROBIN, { mode: WishMode.WRITTEN, text: '会被放下' });
    const released = pool.release(ROBIN, b);
    assert.equal(released.state, WishState.RELEASED);
    assert.equal(released.text, null);
  });
});

describe('「成了」币光强随年月淡出（Robin 2026-10-31）', () => {
  test('glowIntensity：刚成了为 1，约 GLOW_FADE_YEARS 年线性到 0', () => {
    assert.equal(GLOW_FADE_YEARS, 3);
    const t0 = new Date('2026-10-25T08:00:00Z');
    assert.equal(glowIntensity(t0, t0), 1);
    const mid = new Date(t0.getTime() + (GLOW_FADE_YEARS / 2) * 365.25 * 86_400_000);
    assert.ok(Math.abs(glowIntensity(t0, mid) - 0.5) < 1e-9);
    const end = new Date(t0.getTime() + GLOW_FADE_YEARS * 365.25 * 86_400_000);
    assert.equal(glowIntensity(t0, end), 0);
    const later = new Date(end.getTime() + 86_400_000);
    assert.equal(glowIntensity(t0, later), 0);
    assert.equal(glowIntensity(null, t0), 0);
  });

  test('publicView：等待 glow=0；成了随时间淡出；放下不出现；状态不变', () => {
    const t = fakeClock('2026-10-25T08:00:00Z');
    const pool = createWishPool({ clock: t.clock });
    const waitingId = wishOnce(pool, ROBIN);
    t.advanceDays(1);
    const fulfilledId = wishOnce(pool, OTHER);
    pool.thank(OTHER, fulfilledId);
    // 致谢当下光强应为 1
    let view = pool.publicView();
    const justFulfilled = view.coins.find((c) => c.glowing);
    assert.ok(Math.abs(justFulfilled.glow - 1) < 1e-6);

    t.advanceDays(1);
    const releasedId = wishOnce(pool, ROBIN);
    pool.release(ROBIN, releasedId);

    view = pool.publicView();
    assert.equal(view.inPool, 2);
    assert.equal(view.waiting, 1);
    assert.equal(view.glowing, 1);
    const waitingCoin = view.coins.find((c) => !c.glowing);
    const fulfilledCoin = view.coins.find((c) => c.glowing);
    assert.equal(waitingCoin.glow, 0);
    // 过了一天，略暗一点，仍接近满光
    assert.ok(fulfilledCoin.glow < 1 && fulfilledCoin.glow > 0.99);

    // 过 1.5 年：约一半光强；WishState 仍为 fulfilled / waiting
    t.advanceDays((GLOW_FADE_YEARS / 2) * 365.25);
    view = pool.publicView();
    const faded = view.coins.find((c) => c.glowing);
    assert.ok(Math.abs(faded.glow - 0.5) < 0.02);
    assert.equal(pool.myWish(OTHER, fulfilledId).state, WishState.FULFILLED);
    assert.equal(pool.myWish(ROBIN, waitingId).state, WishState.WAITING);

    // 再过 1.5 年：光强到 0，仍在池中、仍 glowing（成了），只是暗了
    t.advanceDays((GLOW_FADE_YEARS / 2) * 365.25);
    view = pool.publicView();
    const dark = view.coins.find((c) => c.glowing);
    assert.equal(dark.glow, 0);
    assert.equal(dark.glowing, true);
    assert.equal(view.glowing, 1);
    assert.equal(pool.myWish(OTHER, fulfilledId).state, WishState.FULFILLED);
  });

  test('glowFadeYears 可配置', () => {
    const t = fakeClock();
    const pool = createWishPool({ clock: t.clock, glowFadeYears: 1 });
    const id = wishOnce(pool, ROBIN);
    pool.thank(ROBIN, id);
    t.advanceDays(182.625); // 半年
    const coin = pool.publicView().coins.find((c) => c.glowing);
    assert.ok(Math.abs(coin.glow - 0.5) < 0.02);
  });
});
