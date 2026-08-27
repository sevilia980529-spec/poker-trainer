import type { Level } from '../../lib/level';
import Icon from '../Icon';

interface LevelBadgeProps {
  level: Level;
  size?: 'sm' | 'md' | 'lg';
  showName?: boolean;
}

const SIZE_CLASSES = {
  sm: 'text-[10px] px-1.5 py-0.5 gap-0.5',
  md: 'text-xs px-2 py-0.5 gap-1',
  lg: 'text-sm px-3 py-1 gap-1.5',
};

export default function LevelBadge({ level, size = 'md', showName = true }: LevelBadgeProps) {
  return (
    <span
      className={`inline-flex items-center font-bold rounded-full ${SIZE_CLASSES[size]}`}
      style={{
        backgroundColor: level.color + '30',
        color: level.textColor === '#000000' ? level.color : level.textColor,
        border: `1px solid ${level.color}`,
      }}
    >
      <Icon name={level.icon} size={14} className="align-middle" />
      {showName && <span>{level.name}</span>}
    </span>
  );
}
