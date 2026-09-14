'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { DEFAULT_HOME_CONFIG, type HomeConfig } from '@/lib/types';

export default function LoginPage() {
  const router = useRouter();
  const [cfg, setCfg] = useState<HomeConfig>(DEFAULT_HOME_CONFIG);
  const [persons, setPersons] = useState<{ username?: string; password?: string; name: string }[]>([]);
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const captchaRef = useRef<HTMLCanvasElement>(null);

  const genCaptcha = () => {
    const s = Math.random().toString(36).slice(2, 6);
    setCaptchaText(s);
    return s;
  };

  function drawCaptcha(raw: string) {
    const canvas = captchaRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 22px system-ui';
    ctx.fillStyle = '#374151';
    const w = raw.split('').map((ch, i) => {
      ctx.save();
      ctx.translate(14 + i * 18, 26);
      ctx.rotate((Math.random() - 0.5) * 0.5);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      return '';
    });
    void w;
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = `rgba(${Math.floor(Math.random() * 150) + 60},${Math.floor(Math.random() * 150) + 60},${Math.floor(Math.random() * 150) + 60},0.4)`;
      ctx.beginPath();
      ctx.moveTo(Math.random() * 90, Math.random() * 34);
      ctx.lineTo(Math.random() * 90, Math.random() * 34);
      ctx.stroke();
    }
  }

  useEffect(() => {
    fetch('/api/state')
      .then((r) => r.json())
      .then((j) => {
        if (j?.config) setCfg({ ...DEFAULT_HOME_CONFIG, ...j.config });
        if (Array.isArray(j?.persons)) setPersons(j.persons);
      })
      .catch(() => {});
    const c = genCaptcha();
    if (document.fonts?.ready) document.fonts.ready.then(() => drawCaptcha(c));
  }, []);

  const refreshCaptcha = () => drawCaptcha(genCaptcha());

  const doLogin = () => {
    setError('');
    if (!account.trim() || !password) {
      setError('请输入账号和密码');
      return;
    }
    if (code.trim().toLowerCase() !== captchaText.toLowerCase()) {
      setError('验证码不正确');
      refreshCaptcha();
      setCode('');
      return;
    }
    const user = persons.find((p) => p.username === account.trim() && p.password === password);
    const isDefaultAdmin = account.trim() === 'admin' && password === '123456';
    if (!user && !isDefaultAdmin) {
      setError('账号或密码错误');
      return;
    }
    setLoading(true);
    const who = user ? user.name : '管理员';
    localStorage.setItem('dn_auth', who);
    setTimeout(() => router.replace('/'), 350);
  };

  const bgStyle =
    cfg.bgMode === 'image' && cfg.bgImage
      ? { backgroundImage: `url(${cfg.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : { backgroundColor: cfg.bgColor };

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* 左侧：平台品牌区 */}
      <div
        className="relative flex flex-1 items-center px-12"
        style={{ ...bgStyle, justifyContent: cfg.titleX === 'left' ? 'flex-start' : cfg.titleX === 'center' ? 'center' : 'flex-end' }}
      >
        <div
          className="flex max-w-xl flex-col"
          style={{ alignItems: cfg.titleX === 'left' ? 'flex-start' : cfg.titleX === 'center' ? 'center' : 'flex-end' }}
        >
          <div
            className="font-bold leading-tight"
            style={{ fontFamily: cfg.title.font, fontSize: cfg.title.size, color: cfg.title.color, opacity: cfg.title.opacity }}
          >
            {cfg.title.text}
          </div>
          <div
            className="mt-3"
            style={{ fontFamily: cfg.subtitle.font, fontSize: cfg.subtitle.size, color: cfg.subtitle.color, opacity: cfg.subtitle.opacity }}
          >
            {cfg.subtitle.text}
          </div>
        </div>
      </div>

      {/* 右侧：登录表单 */}
      <div className="flex w-[420px] shrink-0 flex-col justify-center bg-white px-10 shadow-xl">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-blue-600">
            <ShieldCheck size={24} />
            <span className="text-lg font-bold text-gray-800">店牛预警平台</span>
          </div>
          <div className="mt-1 text-xs text-gray-400">请登录您的账号</div>
        </div>

        <label className="mb-1 text-xs text-gray-500">账号</label>
        <input
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          placeholder="请输入账号"
          className="mb-4 h-11 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-blue-400"
          autoFocus
        />

        <label className="mb-1 text-xs text-gray-500">密码</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="请输入密码"
          onKeyDown={(e) => e.key === 'Enter' && doLogin()}
          className="mb-4 h-11 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-blue-400"
        />

        <label className="mb-1 text-xs text-gray-500">验证码</label>
        <div className="mb-6 flex items-center gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="验证码"
            maxLength={4}
            className="h-11 flex-1 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-blue-400"
          />
          <canvas ref={captchaRef} width={90} height={34} className="cursor-pointer rounded-md" onClick={refreshCaptcha} />
          <button onClick={refreshCaptcha} className="text-gray-400 hover:text-gray-600" title="刷新验证码">
            <RefreshCw size={16} />
          </button>
        </div>

        {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

        <button
          onClick={doLogin}
          disabled={loading}
          className="h-11 w-full rounded-lg bg-blue-600 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? '登录中…' : '登录'}
        </button>

        <div className="mt-6 text-center text-[11px] text-gray-300">© 店牛预警平台 · 零售终端数据预警与通知</div>
      </div>
    </div>
  );
}