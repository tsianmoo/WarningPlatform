'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { DEFAULT_HOME_CONFIG, type HomeConfig } from '@/lib/types';

export default function LoginPage() {
  const router = useRouter();
  const [cfg, setCfg] = useState<HomeConfig>(DEFAULT_HOME_CONFIG);
  const [users, setUsers] = useState<{ username?: string; password?: string; name: string; type: string; id?: string }[]>([]);
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
        type Row = { id?: string; username?: string; password?: string; name?: string; code?: string };
        const toAcct = (r: Row, type: string) => ({ username: (r.username ?? r.code) || '', password: r.password || '', name: r.name || r.code || r.username || '', type, id: r.id || '' });
        const all = [
          ...(Array.isArray(j?.persons) ? (j.persons as Row[]).map((p) => toAcct(p, 'person')) : []),
          ...(Array.isArray(j?.dealers) ? (j.dealers as Row[]).map((d) => toAcct(d, 'dealer')) : []),
          ...(Array.isArray(j?.stores) ? (j.stores as Row[]).map((s) => toAcct(s, 'store')) : []),
          ...(Array.isArray(j?.employees) ? (j.employees as Row[]).map((e) => toAcct(e, 'employee')) : []),
        ];
        setUsers(all);
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
    const user = users.find((p) => p.username === account.trim() && p.password === password);
    const isDefaultAdmin = account.trim() === 'admin' && password === '123456';
    if (!user && !isDefaultAdmin) {
      setError('账号或密码错误');
      return;
    }
    setLoading(true);
    const who = user ? user.name : '管理员';
    localStorage.setItem('dn_auth', who);
    if (user) { localStorage.setItem('dn_auth_type', user.type); localStorage.setItem('dn_auth_id', user.id || ''); }
    setTimeout(() => router.replace('/'), 350);
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
          <div className="flex items-center gap-2 text-blue-600">
            <ShieldCheck size={24} />
            <span className="text-lg font-bold text-gray-800">店牛预警平台</span>
          </div>
          <div className="text-xs text-gray-400">请登录您的账号</div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">账号</label>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="请输入账号"
              style={{ height: cfg.loginBox.fieldHeight }}
              className="rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-blue-400"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              onKeyDown={(e) => e.key === 'Enter' && doLogin()}
              style={{ height: cfg.loginBox.fieldHeight }}
              className="rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-blue-400"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">验证码</label>
            <div className="flex items-center gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="验证码"
                maxLength={4}
                style={{ height: cfg.loginBox.fieldHeight }}
                className="flex-1 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-blue-400"
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
            className="h-11 w-full rounded-lg bg-blue-600 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? '登录中…' : '登录'}
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
    </div>
  );
}