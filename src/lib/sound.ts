// 轻量音效库：全部用 WebAudio 合成，无需音频素材文件
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
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
}

/** 牌面摩擦声（发牌/翻牌） */
export function playDeal() {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  const dur = 0.09;
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource(); src.buffer = buf;
  const filter = c.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 2400; filter.Q.value = 0.8;
  const g = c.createGain(); env(g, t, 0.25, dur);
  src.connect(filter).connect(g).connect(c.destination);
  src.start(t);
}

/** 筹码碰撞声（下注/跟注） */
export function playChips() {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  [0, 0.045, 0.1].forEach((offset, i) => {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 2600 + Math.random() * 1200 + i * 300;
    const g = c.createGain(); env(g, t + offset, 0.12, 0.06);
    osc.connect(g).connect(c.destination);
    osc.start(t + offset); osc.stop(t + offset + 0.07);
  });
}

/** 按钮点击 */
export function playClick() {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sine'; osc.frequency.value = 880;
  const g = c.createGain(); env(g, t, 0.08, 0.05);
  osc.connect(g).connect(c.destination);
  osc.start(t); osc.stop(t + 0.06);
}

/** 弃牌（低沉短音） */
export function playFold() {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(320, t);
  osc.frequency.exponentialRampToValueAtTime(140, t + 0.18);
  const g = c.createGain(); env(g, t, 0.15, 0.2);
  osc.connect(g).connect(c.destination);
  osc.start(t); osc.stop(t + 0.22);
}

/** 胜利琶音 */
export function playWin() {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    const osc = c.createOscillator();
    osc.type = 'triangle'; osc.frequency.value = f;
    const g = c.createGain(); env(g, t + i * 0.09, 0.16, 0.35);
    osc.connect(g).connect(c.destination);
    osc.start(t + i * 0.09); osc.stop(t + i * 0.09 + 0.4);
  });
}

/** 输掉底池（下行音） */
export function playLose() {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  [392, 311].forEach((f, i) => {
    const osc = c.createOscillator();
    osc.type = 'sine'; osc.frequency.value = f;
    const g = c.createGain(); env(g, t + i * 0.12, 0.12, 0.3);
    osc.connect(g).connect(c.destination);
    osc.start(t + i * 0.12); osc.stop(t + i * 0.12 + 0.35);
  });
}
