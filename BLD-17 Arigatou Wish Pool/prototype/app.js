import { createWishPool, WishState, WishMode } from '../src/wishpool.js';

const INSCRIPTION = '投个币，许个愿，不一定包成，万一成了，说句阿里亚多就好';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── 演示时钟：可以“过一天” ─────────────────────────────
let dayOffset = 0;
const clock = () => new Date(Date.now() + dayOffset * 86_400_000);
const pool = createWishPool({ clock });

// ── 种下一些别的居民的币，让池子不是空的 ──────────────
(function seed() {
  for (let i = 0; i < 64; i += 1) {
    const actor = `resident:seed-${i}`;
    // 在「过去」投币／致谢，再把演示时钟拨回今天，这样成了的币自带年纪、光强参差
    const ageDays = i % 5 === 0 ? Math.floor((Math.floor(i / 5) % 7) * (365.25 / 2)) : i;
    dayOffset = -ageDays;
    const { coinToken } = pool.claimCoin(actor);
    const { coinId } = pool.makeWish(actor, { coinToken });
    if (i % 5 === 0) pool.thank(actor, coinId);
  }
  dayOffset = 0;
})();

// ── 界面状态 ─────────────────────────────────────────
let actor = 'resident:you';
let mode = WishMode.SILENT;
/** 本人客户端才知道的映射：coinId -> renderId（只用于给自己的币做动画） */
const myRender = new Map();
const pendingRelease = new Set();

const $ = (id) => document.getElementById(id);
const canvas = $('pool');
const ctx = canvas.getContext('2d');

// ── 几何 ────────────────────────────────────────────
let W = 0;
let H = 0;
let geo = null;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  W = rect.width;
  H = rect.width * 10 / 16;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = W / 2;
  const cy = H * 0.63;
  const rx = W * 0.36;
  const ry = rx * 0.36;
  geo = { cx, cy, rx, ry, rim: rx * 0.085 };
}

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** renderId -> 池底位置（避开中心的泉眼） */
function coinPos(renderId) {
  const h = hash(renderId);
  const a = ((h & 0xffff) / 0xffff) * Math.PI * 2;
  const r = 0.2 + 0.68 * Math.sqrt(((h >>> 16) & 0xffff) / 0xffff);
  return {
    x: geo.cx + Math.cos(a) * r * (geo.rx - geo.rim * 1.6),
    y: geo.cy + Math.sin(a) * r * (geo.ry - geo.rim * 0.7),
    tilt: ((h >>> 8) & 0xff) / 255,
  };
}

// ── 动画 ────────────────────────────────────────────
const effects = []; // { kind, renderId, start, dur }
const fading = new Map(); // renderId -> start（放下时化开）
function addEffect(kind, renderId, dur) {
  if (reduceMotion) return;
  effects.push({ kind, renderId, start: performance.now(), dur });
}

// ── 绘制 ────────────────────────────────────────────
const isNight = () => document.documentElement.dataset.time === 'night';

function drawBackdrop(night) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  if (night) {
    g.addColorStop(0, '#0c1724');
    g.addColorStop(0.42, '#13233a');
    g.addColorStop(0.43, '#1a2a38');
    g.addColorStop(1, '#14212d');
  } else {
    g.addColorStop(0, '#dbe5e8');
    g.addColorStop(0.42, '#e8eef0');
    g.addColorStop(0.43, '#d7d9d3');
    g.addColorStop(1, '#c9ccc5');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 枢纽中心的一道低矮立面，中间是入口，保持通畅
  const top = H * 0.2;
  const base = H * 0.42;
  const door = W * 0.16;
  ctx.fillStyle = night ? '#1d3145' : '#c4ced2';
  ctx.fillRect(W * 0.06, top, W / 2 - door / 2 - W * 0.06, base - top);
  ctx.fillRect(W / 2 + door / 2, top, W * 0.94 - (W / 2 + door / 2), base - top);
  ctx.fillStyle = night ? 'rgba(255,214,150,0.16)' : 'rgba(255,255,255,0.55)';
  const cols = 9;
  for (let side = 0; side < 2; side += 1) {
    const x0 = side === 0 ? W * 0.06 : W / 2 + door / 2;
    const w = (W / 2 - door / 2 - W * 0.06) / cols;
    for (let i = 0; i < cols; i += 1) ctx.fillRect(x0 + i * w + w * 0.2, top + (base - top) * 0.25, w * 0.6, (base - top) * 0.45);
  }
  ctx.fillStyle = night ? '#0f1c29' : '#aab6bb';
  ctx.fillRect(W * 0.04, top - H * 0.025, W * 0.92, H * 0.025);

  // 从入口铺向池子的人行道
  ctx.fillStyle = night ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(W / 2 - door / 2, base);
  ctx.lineTo(W / 2 + door / 2, base);
  ctx.lineTo(W / 2 + door * 1.4, H);
  ctx.lineTo(W / 2 - door * 1.4, H);
  ctx.closePath();
  ctx.fill();
}

function ellipse(cx, cy, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
}

function drawPool(now, night) {
  const { cx, cy, rx, ry, rim } = geo;
  const wall = ry * 0.32;

  // 地面阴影
  ctx.fillStyle = night ? 'rgba(0,0,0,0.35)' : 'rgba(40,50,55,0.18)';
  ellipse(cx, cy + wall + ry * 0.06, rx * 1.03, ry * 1.05);
  ctx.fill();

  // 池壁（可以坐的高度）
  ctx.fillStyle = night ? '#3b4650' : '#bdb7ab';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(cx - rx, cy + wall);
  ctx.ellipse(cx, cy + wall, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();

  // 池沿石面
  ctx.fillStyle = night ? '#4a5661' : '#d8d3c8';
  ellipse(cx, cy, rx, ry);
  ctx.fill();

  // 水面
  const wrx = rx - rim;
  const wry = ry - rim * 0.42;
  ctx.save();
  ellipse(cx, cy, wrx, wry);
  ctx.clip();
  const wg = ctx.createRadialGradient(cx, cy - wry * 0.3, wry * 0.1, cx, cy, wrx);
  if (night) {
    wg.addColorStop(0, '#16394a');
    wg.addColorStop(1, '#0b2230');
  } else {
    wg.addColorStop(0, '#5f9aa3');
    wg.addColorStop(1, '#2f6a77');
  }
  ctx.fillStyle = wg;
  ctx.fillRect(cx - wrx, cy - wry, wrx * 2, wry * 2);

  drawCoins(now, night);
  drawSpring(now, night);
  drawEffects(now);

  // 水面反光
  if (!night) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ellipse(cx - wrx * 0.25, cy - wry * 0.45, wrx * 0.45, wry * 0.18);
    ctx.fill();
  }
  ctx.restore();

  // 黄铜内沿
  ctx.strokeStyle = night ? '#8a6a3a' : '#a9792f';
  ctx.lineWidth = Math.max(1.5, rim * 0.16);
  ellipse(cx, cy, wrx + rim * 0.12, wry + rim * 0.06);
  ctx.stroke();

  drawInscription(night);
}

function drawCoins(now, night) {
  const view = pool.publicView();
  const r = Math.max(3, geo.rx * 0.018);
  const coins = [...view.coins];
  // 正在化开的币仍画一会儿
  for (const [rid] of fading) if (!coins.find((c) => c.renderId === rid)) coins.push({ renderId: rid, glowing: false, fading: true });

  coins.sort((a, b) => coinPos(a.renderId).y - coinPos(b.renderId).y);
  for (const c of coins) {
    const p = coinPos(c.renderId);
    let alpha = 1;
    if (c.fading) {
      const t = (now - fading.get(c.renderId)) / 1400;
      if (t >= 1) {
        fading.delete(c.renderId);
        continue;
      }
      alpha = 1 - t;
    }
    const drop = effects.find((e) => e.kind === 'drop' && e.renderId === c.renderId);
    if (drop && now - drop.start < drop.dur * 0.55) continue; // 还在空中

    const intensity = typeof c.glow === 'number' ? c.glow : c.glowing ? 1 : 0;
    ctx.globalAlpha = alpha;
    if (intensity > 0 && night) {
      const gg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 6);
      gg.addColorStop(0, `rgba(255,196,107,${0.55 * intensity})`);
      gg.addColorStop(1, 'rgba(255,196,107,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(p.x - r * 6, p.y - r * 6, r * 12, r * 12);
    }
    if (intensity > 0) {
      // 在暗底与亮面之间按 intensity 插值，淡出后接近等待中的币
      const lit = night ? [255, 211, 138] : [212, 164, 90];
      const dim = night ? [93, 74, 50] : [160, 112, 63];
      const rgb = lit.map((v, i) => Math.round(dim[i] + (v - dim[i]) * intensity));
      ctx.fillStyle = `rgb(${rgb.join(',')})`;
    } else {
      ctx.fillStyle = night ? '#5d4a32' : '#a0703f';
    }
    ellipse(p.x, p.y, r, r * (0.42 + p.tilt * 0.25));
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawSpring(now, night) {
  const { cx, cy } = geo;
  const t = now / 1000;
  ctx.strokeStyle = night ? 'rgba(180,220,230,0.18)' : 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  const rings = reduceMotion ? [0.5] : [0, 0.33, 0.66];
  for (const off of rings) {
    const k = (t * 0.35 + off) % 1;
    ctx.globalAlpha = 1 - k;
    ellipse(cx, cy, geo.rx * 0.03 + k * geo.rx * 0.1, (geo.rx * 0.03 + k * geo.rx * 0.1) * 0.36);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawEffects(now) {
  for (let i = effects.length - 1; i >= 0; i -= 1) {
    const e = effects[i];
    const t = (now - e.start) / e.dur;
    if (t >= 1) {
      effects.splice(i, 1);
      continue;
    }
    const p = coinPos(e.renderId);
    if (e.kind === 'drop') {
      if (t < 0.55) {
        const k = t / 0.55;
        const x = geo.cx + (p.x - geo.cx) * k;
        const y = geo.cy - geo.ry * 2.2 + (p.y - (geo.cy - geo.ry * 2.2)) * k * k;
        ctx.fillStyle = '#c08a4a';
        ellipse(x, y, 4, 4);
        ctx.fill();
      } else {
        const k = (t - 0.55) / 0.45;
        ripple(p, k, 'rgba(255,255,255,0.5)');
      }
    } else if (e.kind === 'thank') {
      ripple(p, t, 'rgba(255,205,130,0.8)');
      ripple(p, Math.max(0, t - 0.2) / 0.8, 'rgba(255,205,130,0.5)');
    }
  }
}

function ripple(p, k, color) {
  if (k <= 0) return;
  const r = 4 + k * geo.rx * 0.22;
  ctx.globalAlpha = 1 - k;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ellipse(p.x, p.y, r, r * 0.36);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawInscription(night) {
  const { cx, cy, rx, ry, rim } = geo;
  const chars = [...INSCRIPTION];
  const er = rx - rim * 0.5;
  const eq = ry - rim * 0.2;
  // 沿池沿前半圈按等弧长排字，避免两端挤在一起
  const a0 = Math.PI * 0.06;
  const a1 = Math.PI * 0.94;
  const steps = 400;
  const pts = [];
  let total = 0;
  for (let s = 0; s <= steps; s += 1) {
    const a = a1 - (a1 - a0) * (s / steps);
    const p = { a, x: cx + Math.cos(a) * er, y: cy + Math.sin(a) * eq };
    if (pts.length) total += Math.hypot(p.x - pts[pts.length - 1].x, p.y - pts[pts.length - 1].y);
    p.len = total;
    pts.push(p);
  }
  const size = Math.max(9, Math.min(rim * 0.7, (total / chars.length) * 0.82));
  ctx.fillStyle = night ? '#d9b072' : '#7a5520';
  ctx.font = `${size}px ${getComputedStyle(document.documentElement).getPropertyValue('--serif')}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let k = 0;
  chars.forEach((ch, i) => {
    const target = (total * (i + 0.5)) / chars.length;
    while (k < pts.length - 1 && pts[k].len < target) k += 1;
    const { a, x, y } = pts[k];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(Math.cos(a) * eq, -Math.sin(a) * er) + Math.PI);
    ctx.scale(1, 0.78);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
}

function frame(now) {
  const night = isNight();
  drawBackdrop(night);
  drawPool(now, night);
  if (!reduceMotion || effects.length || fading.size) requestAnimationFrame(frame);
}

function kick() {
  if (reduceMotion) requestAnimationFrame(frame);
}

// ── 声音：致谢时一声很轻的铃 ─────────────────────────
let audio = null;
function chime() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(i ? 0.03 : 0.06, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 1.9);
    });
  } catch {
    // 没有声音也不影响许愿
  }
}

// ── 界面 ────────────────────────────────────────────
const fmt = (iso) => new Date(iso).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });

function renderCount() {
  const v = pool.publicView();
  const lit = v.coins.filter((c) => c.glow > 0).length;
  $('count').textContent = `池中 ${v.inPool} 枚币，其中 ${v.glowing} 枚成了（此刻还亮着 ${lit} 枚）。`;
}

function renderMine() {
  const list = $('mine');
  list.textContent = '';
  const mine = [...pool.myWishes(actor)].reverse();
  if (!mine.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '还没有投过币。';
    list.append(li);
    return;
  }
  for (const w of mine) {
    const li = document.createElement('li');
    li.className = `state-${w.state}`;
    const what = document.createElement('span');
    what.className = 'what';
    const label = w.mode === WishMode.WRITTEN && w.text ? w.text : w.state === WishState.RELEASED ? '一个放下了的愿望' : '一个在心里许的愿';
    what.append(label);
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent =
      w.state === WishState.WAITING
        ? `${fmt(w.wishedAt)}许下，还在等`
        : w.state === WishState.FULFILLED
          ? `${fmt(w.wishedAt)}许下，${fmt(w.settledAt)}成了`
          : `${fmt(w.wishedAt)}许下，${fmt(w.settledAt)}放下了`;
    what.append(when);
    li.append(what);

    if (w.state === WishState.WAITING) {
      const thank = document.createElement('button');
      thank.type = 'button';
      thank.className = 'act';
      thank.textContent = '说阿里亚多';
      thank.addEventListener('click', () => act(() => {
        pool.thank(actor, w.coinId);
        addEffect('thank', myRender.get(w.coinId), 2200);
        chime();
        say(isNight() ? '阿里亚多。池底又亮了一枚——它会随年月慢慢变暗。' : '阿里亚多。到了夜里它会亮着，也会慢慢变暗。');
      }));
      const rel = document.createElement('button');
      rel.type = 'button';
      rel.className = 'link';
      const confirming = pendingRelease.has(w.coinId);
      rel.textContent = confirming ? (w.mode === WishMode.WRITTEN ? '确定放下？写下的内容会被删除' : '确定放下？') : '放下';
      rel.addEventListener('click', () => {
        if (!pendingRelease.has(w.coinId)) {
          pendingRelease.add(w.coinId);
          renderMine();
          return;
        }
        act(() => {
          pendingRelease.delete(w.coinId);
          pool.release(actor, w.coinId);
          const rid = myRender.get(w.coinId);
          if (rid && !reduceMotion) fading.set(rid, performance.now());
          say('放下了。');
        });
      });
      li.append(thank, rel);
    }
    list.append(li);
  }
}

function say(text) {
  $('msg').textContent = text;
}

function act(fn) {
  try {
    fn();
  } catch (err) {
    say(err.message);
  }
  renderCount();
  renderMine();
  kick();
}

function setPressed(groupId, attr, value) {
  for (const b of $(groupId).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset[attr] === value));
}

$('who').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  actor = b.dataset.actor;
  setPressed('who', 'actor', actor);
  pendingRelease.clear();
  if (actor.startsWith('visitor:')) say('外来访客不能领币许愿。');
  else say(actor === 'resident:you' ? '' : '换成另一位居民，你的愿望在这里看不到。');
  renderMine();
});

$('time').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  document.documentElement.dataset.time = b.dataset.time;
  setPressed('time', 'time', b.dataset.time);
  kick();
});

$('mode').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  mode = b.dataset.mode;
  setPressed('mode', 'mode', mode);
  $('writeBox').hidden = mode !== WishMode.WRITTEN;
  if (mode === WishMode.WRITTEN) $('text').focus();
});

/** 已领到手、还没投出的币。许愿因为没写内容等原因没成功时，币不会白白丢掉。 */
const heldCoin = new Map(); // actor -> coinToken

$('toss').addEventListener('click', () => act(() => {
  const before = new Set(pool.publicView().coins.map((c) => c.renderId));
  let coinToken = heldCoin.get(actor);
  if (!coinToken) {
    coinToken = pool.claimCoin(actor).coinToken;
    heldCoin.set(actor, coinToken);
  }
  let coinId;
  try {
    ({ coinId } = pool.makeWish(actor, { coinToken, mode, text: $('text').value }));
  } catch (err) {
    if (err.code === 'NO_COIN') heldCoin.delete(actor); // 过了当天的币已作废
    throw err;
  }
  heldCoin.delete(actor);
  const rid = pool.publicView().coins.map((c) => c.renderId).find((r) => !before.has(r));
  myRender.set(coinId, rid);
  addEffect('drop', rid, 1600);
  $('text').value = '';
  say('币沉到了水底。');
}));

$('nextDay').addEventListener('click', () => {
  dayOffset += 1;
  heldCoin.clear(); // 前一天没投出的币作废
  say('过了一天，可以再领一枚了。');
  renderCount();
  kick();
});

$('nextYear').addEventListener('click', () => {
  dayOffset += 365;
  heldCoin.clear();
  say('过了一年。成了的币又暗了一点。');
  renderCount();
  kick();
});

window.addEventListener('resize', () => {
  resize();
  kick();
});

resize();
renderCount();
renderMine();
requestAnimationFrame(frame);
