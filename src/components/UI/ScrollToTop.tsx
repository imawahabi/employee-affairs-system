import React, { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

type ScrollToTopProps = {
  offset?: number;
  className?: string;
  containerId?: string;
};

const ScrollToTop: React.FC<ScrollToTopProps> = ({ offset = 200, className = '', containerId = 'app-scroll' }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const scrollTarget = containerId ? document.getElementById(containerId) : null;
    const target: Window | HTMLElement = scrollTarget || window;

    const onScroll = () => {
      const scrollY =
        target === window
          ? window.pageYOffset || document.documentElement.scrollTop || 0
          : (target as HTMLElement).scrollTop;
      setVisible(scrollY > offset);
    };

    target.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    return () => {
      target.removeEventListener('scroll', onScroll);
    };
  }, [offset, containerId]);

  const scrollToTop = () => {
    const scrollTarget = containerId ? document.getElementById(containerId) : null;
    if (scrollTarget) {
      scrollTarget.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <button
      type="button"
      onClick={scrollToTop}
      className={`group fixed bottom-6 left-6 z-50 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/85 text-slate-700 shadow-lg shadow-slate-300/60 hover:shadow-blue-300/60 transition-all duration-300 hover:border-blue-300 hover:bg-blue-600 hover:text-white ${className}`}
      style={{
        backdropFilter: 'blur(10px)',
        display: visible ? 'inline-flex' : 'none',
      }}
      aria-label="العودة لأعلى الصفحة"
      title="العودة لأعلى الصفحة"
    >
        <ArrowUp className="h-4 w-4" />

    </button>
  );
};

export default ScrollToTop;
