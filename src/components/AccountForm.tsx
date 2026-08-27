import { useRef, useState } from 'react';
import { AVATARS } from '../store/userStore';
import { compressAvatar } from '../lib/avatar';
import { useToast } from './common/Toast';

interface AccountFormProps {
  onSubmit: (nickname: string, avatar: string) => void;
  submitLabel?: string;
  initialNickname?: string;
  initialAvatar?: string;
}

// 创建 / 添加账号共用的表单：昵称 + emoji 预设 + 图片上传（压缩为 dataURL）
export default function AccountForm({
  onSubmit,
  submitLabel = '保存',
  initialNickname = '',
  initialAvatar = '😎',
}: AccountFormProps) {
  const [nickname, setNickname] = useState(initialNickname);
  const [avatar, setAvatar] = useState(initialAvatar);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error('图片太大（限 8MB）');
      return;
    }
    setUploading(true);
    try {
      const url = await compressAvatar(file, 256);
      setAvatar(url);
      toast.success('头像已设置');
    } catch {
      toast.error('头像处理失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const isImg = avatar.startsWith('data:') || avatar.startsWith('http');

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center overflow-hidden shadow-lg">
          {isImg ? (
            <img src={avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-4xl">{avatar}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="text-xs text-gold border border-gold/40 rounded-full px-3 py-1 active:scale-95 disabled:opacity-50"
        >
          {uploading ? '处理中…' : '📷 上传图片头像'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      </div>

      <div>
        <label className="text-xs text-ivory/60">昵称</label>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={12}
          placeholder="输入昵称"
          className="mt-1 w-full bg-ink-light border border-gold-dark/40 rounded-lg px-3 py-2 text-ivory text-sm outline-none focus:border-gold"
        />
      </div>

      <div>
        <label className="text-xs text-ivory/60">或选择一个表情头像</label>
        <div className="grid grid-cols-6 gap-2 mt-2">
          {AVATARS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAvatar(a)}
              className={`text-2xl p-2 rounded-xl transition-all active:scale-95 ${
                a === avatar ? 'bg-gold/20 ring-2 ring-gold' : 'bg-ink-light hover:bg-ink'
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onSubmit(nickname.trim() || '新玩家', avatar)}
        className="w-full bg-gradient-to-r from-gold-dark to-gold text-black font-bold rounded-full py-2.5 active:scale-95"
      >
        {submitLabel}
      </button>
    </div>
  );
}
