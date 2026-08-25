import type { Card } from '../engine/cards';
import { RANK_LABEL, SUIT_SYMBOL } from '../engine/cards';
import { cn } from '../lib/utils';

export function PlayingCard({ card, faceDown, small }: { card?: Card; faceDown?: boolean; small?: boolean }) {
  const size = small ? 'w-9 h-13 text-sm' : 'w-12 h-17 text-lg';
  if (faceDown || !card) {
    return (
      <div className={cn(size, 'rounded-md bg-gradient-to-br from-blue-800 to-blue-950 border border-blue-600 shadow flex items-center justify-center')}>
        <span className="text-blue-400 text-xs">◆</span>
      </div>
    );
  }
  const red = card.suit === 'h' || card.suit === 'd';
  return (
    <div className={cn(size, 'rounded-md bg-white border border-gray-300 shadow flex flex-col items-center justify-center leading-none font-bold',
      red ? 'text-red-600' : 'text-gray-900')}>
      <span>{RANK_LABEL[card.rank]}</span>
      <span className={small ? 'text-xs' : 'text-base'}>{SUIT_SYMBOL[card.suit]}</span>
    </div>
  );
}
