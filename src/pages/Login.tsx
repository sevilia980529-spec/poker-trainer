import { useState } from 'react';
import { useNavigate } from 'react-router';
import Input from '../components/common/Input';
import PasswordInput from '../components/common/PasswordInput';
import Button from '../components/common/Button';
import Icon from '../components/Icon';
import { useAuthStore } from '../store/authStore';
import { isValidEmail } from '../../shared/validators';
import { LS_KEYS } from '../../shared/constants';

/**
 * 登录页（ARCH §5.1 / T04）：邮箱 + 密码。
 * 成功后 doAuth 流水线会自动 applyRemote + 启动同步引擎，并视情况弹出迁移窗。
 */
export default function Login() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const [email, setEmail] = useState<string>(() => localStorage.getItem(LS_KEYS.LAST_EMAIL) ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (): Promise<void> => {
    setError(null);
    const normalized = email.trim().toLowerCase();
    if (!isValidEmail(normalized)) {
      setError('请输入正确的邮箱地址');
      return;
    }
    if (!password) {
      setError('请输入密码');
      return;
    }
    setLoading(true);
    const res = await login({ email: normalized, password });
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? null);
      return;
    }
    localStorage.setItem(LS_KEYS.LAST_EMAIL, normalized);
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-ink px-6 py-10">
      <button
        type="button"
        onClick={() => navigate('/')}
        aria-label="返回"
        className="absolute top-4 left-4 w-10 h-10 flex items-center justify-center rounded-full bg-ink-light text-ivory/70 hover:text-ivory active:scale-95"
      >
        ‹
      </button>

      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center shadow-xl mb-4">
        <Icon e="🃏" size={36} className="align-middle" />
      </div>
      <h1 className="text-2xl font-bold text-ivory">登录云端账号</h1>
      <p className="text-sm text-ivory/50 mt-1 mb-6">进度自动同步到云端，换设备也不丢</p>

      <div className="w-full max-w-sm glass rounded-2xl p-5 space-y-4">
        <Input
          label="邮箱"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
          autoComplete="email"
          inputMode="email"
          error={error && error.includes('邮箱') ? error : undefined}
          onEnter={submit}
        />

        <PasswordInput
          label="密码"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          error={error && !error.includes('邮箱') ? error : undefined}
          onEnter={submit}
        />

        {error && (
          <p className="text-xs text-danger -mt-1">{error}</p>
        )}

        <Button fullWidth size="lg" loading={loading} onClick={submit}>
          登录
        </Button>

        <div className="text-center text-sm text-ivory/60">
          还没有账号？{' '}
          <button
            type="button"
            onClick={() => navigate('/register')}
            className="text-gold font-medium active:scale-95"
          >
            去注册
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate('/')}
        className="text-xs text-ivory/30 mt-6 active:scale-95"
      >
        暂不登录，继续游客模式
      </button>
    </div>
  );
}
