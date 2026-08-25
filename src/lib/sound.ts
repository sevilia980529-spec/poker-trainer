// 轻量音效库 v2：WebAudio 多层合成，逼近真实牌桌质感（纸牌摩擦、黏土筹码碰撞）
// 首次需要用户手势激活（浏览器自动播放策略），之后随时可播

let ctx: AudioContext | null = null;
let muted = typeof localStorage !== 'undefined' && localStorage.getItem('poker-muted') === '1';

export function isMuted() { return muted; }
export function setMuted(v: boolean) {
  muted = v;
  try { localStorage.setItem('poker-muted', v ? '1' : '0'); } catch { /* ignore */ }
}

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

// 首次任意触摸/点击时激活音频上下文
if (typeof window !== 'undefined') {
  const unlock = () => { ac(); };
  window.addEventListener('pointerdown', unlock, { once: true });
}

function env(gain: GainNode, t: number, peak: number, decay: number) {
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
}

/** 白噪声源工具 */
function noise(c: AudioContext, dur: number): AudioBufferSourceNode {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

/** 纸牌在呢绒上滑过 + 落牌轻触（发牌/发公共牌） */
export function playDeal() {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  // 摩擦层：带通噪声，频率从高处下滑，模拟纸牌滑过绒布
  const sw = noise(c, 0.14);
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(3400, t);
  bp.frequency.exponentialRampToValueAtTime(1400, t + 0.12);
  const g1 = c.createGain(); env(g1, t, 0.22, 0.14);
  sw.connect(bp).connect(g1).connect(c.destination);
  sw.start(t);
  // 落牌轻触层
  const tap = noise(c, 0.03);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
  const g2 = c.createGain(); env(g2, t + 0.11, 0.18, 0.05);
  tap.connect(lp).connect(g2).connect(c.destination);
  tap.start(t + 0.11);
}

/** 洗牌：快速交替的纸牌抖动声 */
export function playShuffle() {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  for (let i = 0; i < 6; i++) {
    const s = noise(c, 0.035);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = i % 2 === 0 ? 2600 : 1900;
    bp.Q.value = 1.4;
    const g = c.createGain(); env(g, t + i * 0.055, 0.14, 0.045);
    s.connect(bp).connect(g).connect(c.destination);
    s.start(t + i * 0.055);
  }
}

/** 黏土筹码碰撞：多次高频敲击 + 陶瓷共振（下注/跟注/加注） */
export function playChips(count = 3) {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  for (let i = 0; i < count; i++) {
    const offset = i * (0.038 + Math.random() * 0.02);
    // 陶瓷敲击体
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 2200 + Math.random() * 1600;
    const g = c.createGain(); env(g, t + offset, 0.1, 0.05);
    osc.connect(g).connect(c.destination);
    osc.start(t + offset); osc.stop(t + offset + 0.06);
    // 边缘摩擦噪声
    const n = noise(c, 0.02);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
    const g2 = c.createGain(); env(g2, t + offset, 0.05, 0.02);
    n.connect(hp).connect(g2).connect(c.destination);
    n.start(t + offset);
  }
}

/** 收池：一长串筹码倾泻（赢家收池 / 大胜） */
export function playPotSweep() {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  for (let i = 0; i < 8; i++) {
    const offset = i * 0.045 + Math.random() * 0.015;
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 1800 + Math.random() * 2000;
    const g = c.createGain(); env(g, t + offset, 0.09, 0.05);
    osc.connect(g).connect(c.destination);
    osc.start(t + offset); osc.stop(t + offset + 0.06);
  }
}

/** 按钮点击：短促木质轻触 */
export function playClick() {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sine'; osc.frequency.value = 740;
  const g = c.createGain(); env(g, t, 0.07, 0.045);
  osc.connect(g).connect(c.destination);
  osc.start(t); osc.stop(t + 0.05);
}

/** 弃牌：牌扣在桌上的闷响 */
export function playFold() {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  const n = noise(c, 0.1);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
  const g = c.createGain(); env(g, t, 0.2, 0.11);
  n.connect(lp).connect(g).connect(c.destination);
  n.start(t);
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(210, t);
  osc.frequency.exponentialRampToValueAtTime(120, t + 0.12);
  const g2 = c.createGain(); env(g2, t, 0.1, 0.14);
  osc.connect(g2).connect(c.destination);
  osc.start(t); osc.stop(t + 0.16);
}

/** 胜利：筹码倾泻 + 温暖上行琶音 */
export function playWin() {
  if (muted) return;
  playPotSweep();
  const c = ac(); if (!c) return;
  const t = c.currentTime + 0.1;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    const osc = c.createOscillator();
    osc.type = 'triangle'; osc.frequency.value = f;
    const g = c.createGain(); env(g, t + i * 0.09, 0.12, 0.4);
    osc.connect(g).connect(c.destination);
    osc.start(t + i * 0.09); osc.stop(t + i * 0.09 + 0.45);
  });
}

/** 输掉底池（克制的下行双音） */
export function playLose() {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  [330, 262].forEach((f, i) => {
    const osc = c.createOscillator();
    osc.type = 'sine'; osc.frequency.value = f;
    const g = c.createGain(); env(g, t + i * 0.14, 0.09, 0.32);
    osc.connect(g).connect(c.destination);
    osc.start(t + i * 0.14); osc.stop(t + i * 0.14 + 0.36);
  });
}
