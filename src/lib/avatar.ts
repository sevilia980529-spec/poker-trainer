// 把上传的图片压缩为 256px 以内的 WebP/JPEG dataURL，便于存入 localStorage
export async function compressAvatar(file: File, maxSize = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('当前环境不支持'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload = () => {
        const { width, height } = img;
        const scale = Math.min(1, maxSize / Math.max(width, height));
        const w = Math.max(1, Math.round(width * scale));
        const h = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('canvas 不可用'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        try {
          const url = canvas.toDataURL('image/webp', 0.85);
          resolve(url || canvas.toDataURL('image/jpeg', 0.85));
        } catch {
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
