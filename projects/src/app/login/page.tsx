'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { DEFAULT_HOME_CONFIG, normalizeHomeConfig, type HomeConfig } from '@/lib/types';

export default function LoginPage() {
  const router = useRouter();
  const [cfg, setCfg] = useState<HomeConfig>(DEFAULT_HOME_CONFIG);
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const captchaRef = useRef<HTMLCanvasElement>(null);

  // 初始密码登录后必须改密（服务端 must_change_password 标记）
  const [forceChange, setForceChange] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [newPwd2, setNewPwd2] = useState('');

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
    // 已登录则直接进入系统
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? router.replace('/') : null))
      .catch(() => {});

    // 登录页样式配置走公开接口：只返回视觉配置，
    // 绝不返回业务数据（旧版这里拉 /api/state，把全部账号含明文密码下发给了匿名调用方）。
    fetch('/api/public/login-config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setCfg(normalizeHomeConfig(j?.config)))
      .catch(() => {});
    const c = genCaptcha();
    if (document.fonts?.ready) document.fonts.ready.then(() => drawCaptcha(c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshCaptcha = () => drawCaptcha(genCaptcha());

  const doLogin = async () => {
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
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: account.trim(), password }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        account?: { id?: string; displayName?: string; subjectType?: string; subjectId?: string | null; mustChangePassword?: boolean };
      };
      if (!res.ok) {
        setError(j.error || '登录失败');
        refreshCaptcha();
        setCode('');
        setLoading(false);
        return;
      }
      const who = j.account?.displayName || account.trim();
      localStorage.setItem('dn_auth', who);
      localStorage.setItem('dn_auth_type', j.account?.subjectType || 'person');
      localStorage.setItem('dn_auth_id', j.account?.subjectId || '');
      // 账号唯一 id：用于把浏览器本地缓存按账号隔离，避免多人共用一台电脑时串数据
      localStorage.setItem('dn_account_id', j.account?.id || '');

      if (j.account?.mustChangePassword) {
        setForceChange(true);
        setLoading(false);
        return;
      }
      router.replace('/');
    } catch {
      setError('网络异常，请重试');
      setLoading(false);
    }
  };

  const doChangePassword = async () => {
    setError('');
    if (newPwd.length < 8 || !/[A-Za-z]/.test(newPwd) || !/[0-9]/.test(newPwd)) {
      setError('新密码至少 8 位，且需同时包含字母和数字');
      return;
    }
    if (newPwd !== newPwd2) {
      setError('两次输入的新密码不一致');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: password, newPassword: newPwd }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error || '修改失败');
        setLoading(false);
        return;
      }
      router.replace('/');
    } catch {
      setError('网络异常，请重试');
      setLoading(false);
    }
  };

  const bgStyle =
    cfg.bgMode === 'image' && cfg.bgImage
      ? { backgroundImage: `url(${cfg.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : { backgroundColor: cfg.bgColor };

  const toRgba = (hex: string, a: number) => {
    const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!m) return hex;
    const n = (i: number) => parseInt(m[i], 16);
    return `rgba(${n(1)}, ${n(2)}, ${n(3)}, ${a})`;
  };

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* 背景层（支持背景毛玻璃） */}
      <div className="absolute inset-0" style={{ ...bgStyle, backdropFilter: `blur(${cfg.bgBlur}px)`, WebkitBackdropFilter: `blur(${cfg.bgBlur}px)` }} />

      {/* 主标题（不换行 + 字重/字宽/左边距 + 拖拽位置，transform 与首页管理器预览一致） */}
      <div
        className="absolute max-w-full select-none leading-tight"
        style={{
          left: `${cfg.title.x}%`,
          top: `${cfg.title.y}%`,
          transform: 'translateY(-50%)',
          marginLeft: cfg.title.marginLeft,
          whiteSpace: 'nowrap',
          fontFamily: cfg.title.font,
          fontSize: cfg.title.size,
          fontWeight: cfg.title.weight,
          letterSpacing: `${cfg.title.letterSpacing}px`,
          color: cfg.title.color,
          opacity: cfg.title.opacity,
        }}
      >
        {cfg.title.text}
      </div>

      {/* 副标题（不换行 + 位置，transform 与首页管理器预览一致） */}
      <div
        className="absolute max-w-full select-none"
        style={{
          left: `${cfg.subtitle.x}%`,
          top: `${cfg.subtitle.y}%`,
          transform: 'translateY(-50%)',
          marginLeft: cfg.subtitle.marginLeft,
          whiteSpace: 'nowrap',
          fontFamily: cfg.subtitle.font,
          fontSize: cfg.subtitle.size,
          fontWeight: cfg.subtitle.weight,
          letterSpacing: `${cfg.subtitle.letterSpacing}px`,
          color: cfg.subtitle.color,
          opacity: cfg.subtitle.opacity,
        }}
      >
        {cfg.subtitle.text}
      </div>

      {/* 登录框（尺寸/位置/背景色/透明度/毛玻璃） */}
      <div
        className="absolute flex flex-col overflow-hidden"
        style={{
          left: `${cfg.loginBox.x}%`,
          top: `${cfg.loginBox.y}%`,
          transform: 'translate(-50%,-50%)',
          width: cfg.loginBox.width,
          height: cfg.loginBox.height,
          background: toRgba(cfg.loginBox.bgColor, cfg.loginBox.bgOpacity),
          backdropFilter: `blur(${cfg.loginBox.blur}px)`,
          WebkitBackdropFilter: `blur(${cfg.loginBox.blur}px)`,
          borderRadius: cfg.loginBox.radius,
          boxShadow: `${cfg.loginBox.shadowX}px ${cfg.loginBox.shadowY}px ${cfg.loginBox.shadowBlur}px ${toRgba(cfg.loginBox.shadowColor, cfg.loginBox.shadowOpacity)}`,
        }}
      >
        <div className="flex h-full flex-col justify-evenly" style={{ padding: `${cfg.loginBox.padY}px ${cfg.loginBox.padX}px` }}>
          <div
            className="flex items-center gap-2"
            style={{
              fontFamily: cfg.loginBox.title.font,
              fontSize: cfg.loginBox.title.size,
              fontWeight: cfg.loginBox.title.weight,
              letterSpacing: `${cfg.loginBox.title.letterSpacing}px`,
              color: cfg.loginBox.title.color,
              opacity: cfg.loginBox.title.opacity,
            }}
          >
            <ShieldCheck size={Math.round(cfg.loginBox.title.size * 1.2)} />
            <span>{cfg.loginBox.title.text}</span>
          </div>
          <div
            className="truncate"
            style={{
              fontFamily: cfg.loginBox.subtitle.font,
              fontSize: cfg.loginBox.subtitle.size,
              fontWeight: cfg.loginBox.subtitle.weight,
              letterSpacing: `${cfg.loginBox.subtitle.letterSpacing}px`,
              color: cfg.loginBox.subtitle.color,
              opacity: cfg.loginBox.subtitle.opacity,
            }}
          >
            {cfg.loginBox.subtitle.text}
          </div>

          <div className="flex flex-col gap-1">
            <label
              className="truncate"
              style={{
                fontFamily: cfg.loginBox.label.font,
                fontSize: cfg.loginBox.label.size,
                fontWeight: cfg.loginBox.label.weight,
                letterSpacing: `${cfg.loginBox.label.letterSpacing}px`,
                color: cfg.loginBox.label.color,
                opacity: cfg.loginBox.label.opacity,
              }}
            >
              账号
            </label>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="请输入账号（经销商为 J+编号）"
              style={{ height: cfg.loginBox.fieldHeight }}
              className="rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-gray-400"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              className="truncate"
              style={{
                fontFamily: cfg.loginBox.label.font,
                fontSize: cfg.loginBox.label.size,
                fontWeight: cfg.loginBox.label.weight,
                letterSpacing: `${cfg.loginBox.label.letterSpacing}px`,
                color: cfg.loginBox.label.color,
                opacity: cfg.loginBox.label.opacity,
              }}
            >
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              onKeyDown={(e) => e.key === 'Enter' && doLogin()}
              style={{ height: cfg.loginBox.fieldHeight }}
              className="rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-gray-400"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              className="truncate"
              style={{
                fontFamily: cfg.loginBox.label.font,
                fontSize: cfg.loginBox.label.size,
                fontWeight: cfg.loginBox.label.weight,
                letterSpacing: `${cfg.loginBox.label.letterSpacing}px`,
                color: cfg.loginBox.label.color,
                opacity: cfg.loginBox.label.opacity,
              }}
            >
              验证码
            </label>
            <div className="flex items-center gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="验证码"
                maxLength={4}
                style={{ height: cfg.loginBox.fieldHeight }}
                className="flex-1 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-gray-400"
              />
              <canvas ref={captchaRef} width={90} height={34} className="cursor-pointer rounded-md" onClick={refreshCaptcha} />
              <button onClick={refreshCaptcha} className="text-gray-400 hover:text-gray-600" title="刷新验证码">
                <RefreshCw size={16} />
              </button>
            </div>
          </div>

          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

          <button
            onClick={doLogin}
            disabled={loading}
            style={{
              height: cfg.loginBox.button.height,
              width: cfg.loginBox.button.width ? cfg.loginBox.button.width : '100%',
              fontFamily: 'system-ui',
              fontSize: cfg.loginBox.button.size,
              fontWeight: cfg.loginBox.button.weight,
              letterSpacing: `${cfg.loginBox.button.letterSpacing}px`,
              color: cfg.loginBox.button.color,
              backgroundColor: cfg.loginBox.button.bgColor,
              borderRadius: cfg.loginBox.button.radius,
            }}
            className="flex items-center justify-center transition hover:opacity-90 disabled:opacity-60"
          >
            {loading ? '登录中…' : cfg.loginBox.button.text}
          </button>

          <div className="text-center text-[11px] text-gray-300">© 店牛预警平台 · 零售终端数据预警与通知</div>
        </div>
      </div>

      {/* 画布添加的组件元素（文本 / 图片） */}
      {(cfg.elements || []).map((el) =>
        el.type === 'text' ? (
          <div
            key={el.id}
            className="absolute max-w-full select-none leading-tight"
            style={{
              left: `${el.x}%`,
              top: `${el.y}%`,
              transform: 'translate(-50%,-50%)',
              whiteSpace: 'nowrap',
              fontFamily: el.font,
              fontSize: el.size,
              fontWeight: el.weight,
              letterSpacing: `${el.letterSpacing}px`,
              color: el.color,
              opacity: el.opacity,
            }}
          >
            {el.text}
          </div>
        ) : (
          <img
            key={el.id}
            src={el.src}
            alt=""
            className="pointer-events-none absolute max-w-none select-none object-cover"
            style={{
              left: `${el.x}%`,
              top: `${el.y}%`,
              transform: 'translate(-50%,-50%)',
              width: el.width,
              height: el.height,
              borderRadius: el.borderRadius,
              opacity: el.opacity,
            }}
          />
        ),
      )}

      {forceChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-1 text-base font-semibold text-gray-800">首次登录，请设置新密码</div>
            <p className="mb-4 text-xs text-gray-400">
              当前使用的是初始密码，出于安全考虑需要先修改。新密码至少 8 位，且同时包含字母和数字。
            </p>
            <div className="flex flex-col gap-3">
              <input
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="新密码"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
              />
              <input
                type="password"
                value={newPwd2}
                onChange={(e) => setNewPwd2(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doChangePassword()}
                placeholder="确认新密码"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
              />
              {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
              <button
                onClick={doChangePassword}
                disabled={loading}
                className="rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {loading ? '提交中…' : '确认修改并进入系统'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}