import React, { useEffect, useState } from 'react';
import { ArrowDown } from 'lucide-react';

type ScrollToBottomProps = {
  offset?: number;
  className?: string;
  containerId?: string;
  ariaLabel?: string;
  title?: string;
};

const ScrollToBottom: React.FC<ScrollToBottomProps> = ({
  offset = 200,
  className = '',
  containerId = 'app-scroll',
  ariaLabel = 'Scroll to bottom',
  title = 'Scroll to bottom',
}) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const scrollTarget = containerId ? document.getElementById(containerId) : null;
    const target: Window | HTMLElement = scrollTarget || window;

    const onScroll = () => {
      let scrollTop = 0;
      let scrollHeight = 0;
      let clientHeight = 0;

      if (target === window) {
        const doc = document.documentElement;
        scrollTop = window.pageYOffset || doc.scrollTop || 0;
        scrollHeight = doc.scrollHeight;
        clientHeight = doc.clientHeight;
      } else {
        const element = target as HTMLElement;
        scrollTop = element.scrollTop;
        scrollHeight = element.scrollHeight;
        clientHeight = element.clientHeight;
      }

      const remaining = scrollHeight - (scrollTop + clientHeight);
      setVisible(remaining > offset);
    };

    target.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    return () => {
      target.removeEventListener('scroll', onScroll);
    };
  }, [offset, containerId]);

  const scrollToBottom = () => {
    const scrollTarget = containerId ? document.getElementById(containerId) : null;
    if (scrollTarget) {
      scrollTarget.scrollTo({ top: scrollTarget.scrollHeight, behavior: 'smooth' });
      return;
    }
    const doc = document.documentElement;
    window.scrollTo({ top: doc.scrollHeight, behavior: 'smooth' });
  };

  return (
    <button
      type="button"
      onClick={scrollToBottom}
      className={`group fixed bottom-6 left-6 z-50 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/85 text-slate-700 shadow-lg shadow-slate-300/60 hover:shadow-blue-300/60 transition-all duration-300 hover:border-blue-300 hover:bg-blue-600 hover:text-white ${className}`}
      style={{
        backdropFilter: 'blur(10px)',
        display: visible ? 'inline-flex' : 'none',
      }}
      aria-label={ariaLabel}
      title={title}
    >
      <ArrowDown className="h-4 w-4" />
    </button>
  );
};

export default ScrollToBottom;
