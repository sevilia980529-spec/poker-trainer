import { useState } from 'react';

interface AvatarProps {
  value: string; // emoji / 图片 dataURL / http(s) / 图片路径(/avatars/x.png)
  size?: number; // 像素
  className?: string;
}

function isImageValue(v: string) {
  return (
    v.startsWith('data:') ||
    v.startsWith('http') ||
    v.startsWith('/') ||
    /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(v)
  );
}

// 加载失败时的兜底：金色渐变圆 + 人形剪影，避免出现破图
function Fallback({ size, className }: { size: number; className: string }) {
  return (
    <div
      style={{ width: size, height: size }}
      className={`rounded-full bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center ${className}`}
    >
      <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55} fill="#0A0A0A" aria-hidden>
        <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7 2-7 5v1h14v-1c0-3-3-5-7-5Z" />
      </svg>
    </div>
  );
}

// 统一头像渲染：图片走 <img>，emoji 走 <span>
export default function Avatar({ value, size = 28, className = '' }: AvatarProps) {
  const [errored, setErrored] = useState(false);
  const isImg = isImageValue(value);

  if (isImg && !errored) {
    return (
      <img
        src={value}
        alt=""
        width={size}
        height={size}
        onError={() => setErrored(true)}
        style={{ width: size, height: size }}
        className={`rounded-full object-cover ${className}`}
      />
    );
  }
  if (isImg && errored) {
    return <Fallback size={size} className={className} />;
  }
  return (
    <span style={{ fontSize: Math.round(size * 0.62), lineHeight: 1 }} className={className}>
      {value}
    </span>
  );
}
