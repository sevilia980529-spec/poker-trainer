// 每手牌局结算弹窗（复刻 PokerMind 结算 UI）
import Modal from './common/Modal';
import Button from './common/Button';
import { PlayingCard } from './PlayingCard';
import Avatar from './Avatar';
import Icon from './Icon';
import type { Card } from '../engine/cards';

export interface SettlePlayer {
  name: string;
  avatar: string;
  hole: Card[];        // 亮出的手牌（弃牌/未亮牌传空数组）
  folded: boolean;
  winner: boolean;
  isHero: boolean;
  winAmount?: number;  // 赢家赢取金额
}

interface SettlementModalProps {
  open: boolean;
  onClose: () => void;
  heroWon: boolean;
  delta: number | null;    // 英雄盈亏
  xpGain?: number | null;  // 本手获得 XP
  info: string;            // 结算描述（如「葫芦 · 赢得底池」）
  players: SettlePlayer[];
  onNext: () => void;
  nextLabel?: string;
  onReview?: () => void;
  onHome: () => void;
}

export default function SettlementModal({
  open, onClose, heroWon, delta, xpGain, info, players, onNext, nextLabel = '再来一局 ▶', onReview, onHome,
}: SettlementModalProps) {
  return (
    // 结算弹窗必须让用户点按钮才能走，禁用遮罩点击与 ESC 关闭
    <Modal open={open} onClose={onClose} title={heroWon ? '🎉 胜利！' : '本局结束'} showClose={false} dismissible={false}>
      <div key={open ? 'settle-open' : 'settle-closed'} className="space-y-4 anim-shake">
        {/* 盈亏 */}
        <div className="text-center">
          <div className={`text-3xl font-bold num ${delta !== null && delta > 0 ? 'text-success' : delta !== null && delta < 0 ? 'text-danger' : 'text-ivory'}`}>
            {delta === null ? '—' : delta > 0 ? `+${delta.toLocaleString()}` : delta < 0 ? delta.toLocaleString() : '±0'}
          </div>
          <div className="text-xs text-ivory/60 mt-1">
            欢乐豆{delta !== null && delta > 0 ? '入账' : '变化'}
            {xpGain != null && xpGain > 0 && <span className="text-gold ml-2">+{xpGain} XP</span>}
          </div>
          {info && <div className="text-xs text-ivory/50 mt-1.5">{info}</div>}
        </div>

        {/* 摊牌名单 */}
        <div className="space-y-1.5 max-h-52 overflow-y-auto">
          {players.map((p, i) => (
            <div
              key={i}
              className={`flex items-center justify-between p-2 rounded-lg ${
                p.winner ? 'bg-success/10 border border-success/30 anim-winner shadow-[0_0_16px_rgba(212,168,87,0.3)]' : 'bg-ink-light'
              }`}
            >
              <div className="flex items-center gap-2">
                <Avatar value={p.avatar} size={22} />
                <div>
                  <div className="text-sm text-ivory">
                    {p.name}
                    {p.isHero && <span className="text-gold text-xs ml-1">(你)</span>}
                  </div>
                  {p.hole.length > 0 ? (
                    <div className="flex gap-0.5 mt-0.5">
                      {p.hole.map((c, j) => <PlayingCard key={j} card={c} small />)}
                    </div>
                  ) : (
                    <div className="text-[10px] text-ivory/40 mt-0.5">{p.folded ? '已弃牌' : '未亮牌'}</div>
                  )}
                </div>
              </div>
              {p.winner && (
                <span className="text-success font-bold text-sm">
                  <Icon e="👑" size={14} className="align-middle" /> {p.winAmount ? `+${p.winAmount.toLocaleString()}` : '赢'}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* 操作 */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button variant="secondary" onClick={onHome}>回首页</Button>
          <Button variant="primary" onClick={onNext}>{nextLabel}</Button>
        </div>
        {onReview && (
          <Button fullWidth variant="ghost" onClick={onReview} className="!mt-1">
            <Icon e="📊" size={14} className="align-middle" /> 复盘本手
          </Button>
        )}
      </div>
    </Modal>
  );
}
