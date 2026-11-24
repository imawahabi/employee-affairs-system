import React, { useEffect, useRef, useState } from 'react';
import { isWebCloudMode, getApiToken, setApiToken } from '../api';
import logo from '../assets/logo.png';

// PIN gate for the web/cloud build - 4-digit code entry.
// Skipped entirely in Electron mode or when VITE_API_TOKEN is baked in.
const TokenGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [shake, setShake] = useState(false);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const webMode = isWebCloudMode();
  const hasToken = !!getApiToken();

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  if (!webMode || hasToken) return <>{children}</>;

  const verify = async (value: string) => {
    if (value.length !== 4) return;
    setChecking(true);
    setError('');
    try {
      const base = (import.meta.env?.VITE_API_URL as string).replace(/\/+$/, '');
      const res = await fetch(`${base}/api/sync/status`, {
        headers: { 'x-api-token': value },
      });
      if (res.status === 401) {
        fail();
        return;
      }
      if (!res.ok) {
        setError('تعذر التحقق - حاول لاحقاً');
        setChecking(false);
        return;
      }
      setApiToken(value);
      window.location.reload();
    } catch {
      setError('تعذر الاتصال بالخادم');
      setChecking(false);
    }
  };

  const fail = () => {
    setError('الرمز غير صحيح');
    setShake(true);
    setTimeout(() => setShake(false), 500);
    setPin('');
    inputsRef.current[0]?.focus();
    setChecking(false);
  };

  const handleChange = (idx: number, val: string) => {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = pin.split('');
    next[idx] = digit;
    const joined = next.join('').replace(/undefined/g, '');
    setPin(joined.slice(0, 4));
    if (digit && idx < 3) inputsRef.current[idx + 1]?.focus();
    if (joined.length === 4) void verify(joined);
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[idx] && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (text.length) {
      e.preventDefault();
      setPin(text);
      text.split('').forEach((d, i) => {
        if (inputsRef.current[i]) inputsRef.current[i]!.value = d;
      });
      inputsRef.current[Math.min(text.length, 3)]?.focus();
      if (text.length === 4) void verify(text);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-slate-900 flex items-center justify-center p-4 relative overflow-hidden" dir="rtl">
      <div className="absolute -top-32 -right-32 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-cyan-400/10 rounded-full blur-3xl" />

      <div className={`relative bg-white rounded-[2rem] shadow-2xl w-full max-w-sm p-8 sm:p-10 ${shake ? 'animate-[shake_0.4s_ease-in-out]' : ''}`}>
        <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>

        <div className="flex flex-col items-center mb-8">
          <div className="w-28 h-28 bg-gradient-to-br from-blue-50 to-blue-100 rounded-3xl flex items-center justify-center shadow-inner mb-5 p-3 ring-1 ring-blue-100">
            <img src={logo} alt="شعار الهيئة" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-gray-900 text-2xl font-black">نظام شؤون الموظفين</h1>
          <p className="text-gray-400 text-xs mt-2 text-center leading-relaxed">
            الهيئة العامة للشؤون الإدارية والموارد البشرية<br />النسخة الأونلاين
          </p>
        </div>

        <div className="text-center text-gray-500 text-sm mb-7 font-semibold">أدخل رمز PIN المكون من 4 أرقام</div>

        <div className="flex justify-center gap-3 mb-5" onPaste={handlePaste}>
          {[0, 1, 2, 3].map((i) => (
            <input
              key={i}
              ref={(el) => { inputsRef.current[i] = el; }}
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={pin[i] || ''}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              disabled={checking}
              className={`w-16 h-[4.5rem] text-center text-3xl font-black rounded-2xl border-2 transition-all duration-200 focus:outline-none ${
                pin[i]
                  ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                  : 'border-gray-200 bg-gray-50 text-gray-800 focus:border-blue-400'
              } ${checking ? 'opacity-50' : ''}`}
              style={{ direction: 'ltr' }}
            />
          ))}
        </div>

        {checking && (
          <div className="flex justify-center mb-4">
            <div className="animate-spin rounded-full h-7 w-7 border-[3px] border-blue-200 border-t-blue-600"></div>
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 text-sm mb-4 text-center font-bold rounded-xl py-2.5 px-3">
            {error}
          </div>
        )}

        <button
          onClick={() => pin.length === 4 && verify(pin)}
          disabled={checking || pin.length !== 4}
          className="w-full bg-gradient-to-l from-blue-700 to-blue-600 hover:from-blue-600 hover:to-blue-500 disabled:opacity-40 disabled:from-gray-300 disabled:to-gray-300 text-white font-black py-4 rounded-2xl transition-all text-base shadow-lg shadow-blue-600/25"
        >
          {checking ? 'جارٍ التحقق...' : 'تأكيد الدخول'}
        </button>

        <div className="flex items-center justify-center gap-2 mt-7 text-gray-300 text-[11px]">
          <span className="w-8 h-px bg-gray-200"></span>
          الوصول مقيد - هذا الجهاز مصرّح له فقط
          <span className="w-8 h-px bg-gray-200"></span>
        </div>
      </div>
    </div>
  );
};

export default TokenGate;
