import { useState } from 'react';
import { EMOJI_TO_NAME, iconPath } from '../lib/iconMap';

interface IconProps {
  name?: string; // 直接指定图标名（对应 /icons/<name>.png）
  e?: string; // 传入 emoji，自动映射到图标名
  size?: number; // 像素
  className?: string;
}

// 统一图标渲染：优先用生成的图片，加载失败回退原 emoji（避免破图/空白）
export default function Icon({ name, e, size = 18, className = '' }: IconProps) {
  const [errored, setErrored] = useState(false);
  const resolved = name ?? (e ? EMOJI_TO_NAME[e] : undefined);

  if (resolved && !errored) {
    return (
      <img
        src={iconPath(resolved)}
        alt=""
        width={size}
        height={size}
        onError={() => setErrored(true)}
        style={{ width: size, height: size, objectFit: 'contain', display: 'inline-block', verticalAlign: 'middle' }}
        className={className}
      />
    );
  }
  // 兜底：原 emoji 或中性圆点
  return (
    <span
      style={{ fontSize: size * 0.78, lineHeight: 1, display: 'inline-block', verticalAlign: 'middle' }}
      className={className}
    >
      {e ?? '•'}
    </span>
  );
}
