import { useState } from 'react';
import { useNavigate } from 'react-router';
import Input from '../components/common/Input';
import PasswordInput from '../components/common/PasswordInput';
import Button from '../components/common/Button';
import Icon from '../components/Icon';
import { useAuthStore } from '../store/authStore';
import { isValidEmail, validatePassword } from '../../shared/validators';
import { LIMITS } from '../../shared/constants';

/**
 * 注册页（ARCH §5.1 / T04）：邮箱 + 密码（+ 可选昵称）。
 * 成功后等价自动登录，doAuth 流水线会 applyRemote + 启动同步引擎。
 */
export default function Register() {
  const navigate = useNavigate();
  const register = useAuthStore((s) => s.register);

  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
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
    const pw = validatePassword(password, normalized);
    if (!pw.valid) {
      setError(pw.reason ?? '密码强度不足');
      return;
    }
    const trimmedNick = nickname.trim();
    if (trimmedNick && trimmedNick.length > LIMITS.NICKNAME_MAX) {
      setError(`昵称不超过 ${LIMITS.NICKNAME_MAX} 个字符`);
      return;
    }
    setLoading(true);
    const res = await register({
      email: normalized,
      password,
      nickname: trimmedNick || undefined,
    });
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? null);
      return;
    }
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
      <h1 className="text-2xl font-bold text-ivory">注册云端账号</h1>
      <p className="text-sm text-ivory/50 mt-1 mb-6">创建账号，进度永不丢失</p>

      <div className="w-full max-w-sm glass rounded-2xl p-5 space-y-4">
        <Input
          label="昵称（选填）"
          value={nickname}
          onChange={setNickname}
          placeholder="不填则默认「新玩家」"
          maxLength={LIMITS.NICKNAME_MAX}
          onEnter={() => setEmail(email)}
        />

        <Input
          label="邮箱"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
          autoComplete="email"
          inputMode="email"
          error={error && error.includes('邮箱') ? error : undefined}
          onEnter={() => setPassword(password)}
        />

        <PasswordInput
          label="密码"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          showStrength
          error={error && !error.includes('邮箱') ? error : undefined}
          onEnter={submit}
        />

        {error && <p className="text-xs text-danger -mt-1">{error}</p>}

        <Button fullWidth size="lg" loading={loading} onClick={submit}>
          注册并登录
        </Button>

        <div className="text-center text-sm text-ivory/60">
          已有账号？{' '}
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="text-gold font-medium active:scale-95"
          >
            去登录
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate('/')}
        className="text-xs text-ivory/30 mt-6 active:scale-95"
      >
        暂不注册，继续游客模式
      </button>
    </div>
  );
}
