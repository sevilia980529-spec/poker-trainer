interface AvatarProps {
  value: string; // emoji 或图片 dataURL / http(s)
  size?: number; // 像素
  className?: string;
}

// 统一头像渲染：图片走 <img>，emoji 走 <span>，避免直接渲染 dataURL 字符串
export default function Avatar({ value, size = 28, className = '' }: AvatarProps) {
  const isImg = value.startsWith('data:') || value.startsWith('http');
  if (isImg) {
    return (
      <img
        src={value}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={`rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <span style={{ fontSize: Math.round(size * 0.62), lineHeight: 1 }} className={className}>
      {value}
    </span>
  );
}
