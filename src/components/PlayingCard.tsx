// 拟真扑克牌：四角点数 + 中央花色 + 纸质感高光 + 金纹牌背（设计融合 PokerMind）
import type { Card } from '../engine/cards';
import { RANK_LABEL, SUIT_SYMBOL } from '../engine/cards';
import { cn } from '../lib/utils';

export function PlayingCard({ card, faceDown, small }: { card?: Card; faceDown?: boolean; small?: boolean }) {
  const size = small ? 'w-9 aspect-[5/7]' : 'w-12 aspect-[5/7]';
  const corner = small ? 'text-[7px]' : 'text-[9px]';
  const center = small ? 'text-sm' : 'text-xl';

  // 牌背：深绿渐变 + 金色菱形纹理
  if (faceDown || !card) {
    return (
      <div className={cn(size, 'rounded-md relative overflow-hidden flex items-center justify-center select-none')}
        style={{
          background: 'linear-gradient(135deg, #0a3a26 0%, #0E5C3A 50%, #084A2D 100%)',
          border: '1.5px solid rgba(212, 168, 87, 0.35)',
          boxShadow: '0 3px 6px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)',
        }}>
        <div className="absolute inset-[3px] opacity-50 rounded-[3px]"
          style={{
            background: 'repeating-linear-gradient(45deg, transparent 0 3px, rgba(212,168,87,0.16) 3px 4px), repeating-linear-gradient(-45deg, transparent 0 3px, rgba(212,168,87,0.16) 3px 4px)',
          }} />
        <span className={cn('relative z-10 font-bold', small ? 'text-[10px]' : 'text-sm')}
          style={{ color: 'rgba(212, 168, 87, 0.6)' }}>♠</span>
      </div>
    );
  }

  const red = card.suit === 'h' || card.suit === 'd';
  const color = red ? '#D33A2C' : '#1a1a1a';
  return (
    <div className={cn(size, 'rounded-md relative overflow-hidden select-none font-bold')}
      style={{
        background: 'linear-gradient(145deg, #FDFBF5 0%, #F5EFE0 100%)',
        border: '1px solid rgba(0,0,0,0.18)',
        boxShadow: '0 4px 8px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.7)',
        color,
      }}>
      {/* 顶部纸面高光 */}
      <div className="absolute inset-x-0 top-0 h-1/3 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.45), transparent)' }} />
      {/* 左上角点数 */}
      <div className={cn('absolute top-[2px] left-[3px] flex flex-col items-center leading-[1.1]', corner)}>
        <span>{RANK_LABEL[card.rank]}</span>
        <span>{SUIT_SYMBOL[card.suit]}</span>
      </div>
      {/* 中央大花色 */}
      <div className={cn('absolute inset-0 flex items-center justify-center leading-none', center)}>
        {SUIT_SYMBOL[card.suit]}
      </div>
      {/* 右下角点数（旋转180°） */}
      <div className={cn('absolute bottom-[2px] right-[3px] flex flex-col items-center leading-[1.1] rotate-180', corner)}>
        <span>{RANK_LABEL[card.rank]}</span>
        <span>{SUIT_SYMBOL[card.suit]}</span>
      </div>
    </div>
  );
}
