import React from 'react';
import { Loader2, Zap, Database, Users, Calendar, Settings, Award, Building } from 'lucide-react';

interface LoadingPageProps {
  title?: string;
  subtitle?: string;
  icon?: React.ComponentType<any>;
  variant?: 'default' | 'employees' | 'shifts' | 'settings' | 'departments' | 'ranks' | 'dashboard' | 'new-shift';
}

const LoadingPage: React.FC<LoadingPageProps> = ({
  title,
  subtitle,
  icon: CustomIcon,
  variant = 'default'
}) => {
  // تحديد الأيقونة والألوان حسب النوع
  const getVariantConfig = () => {
    switch (variant) {
      case 'employees':
        return {
          icon: Users,
          title: title || 'جاري تحميل الموظفين',
          subtitle: subtitle || 'يرجى الانتظار بينما نحضر بيانات الموظفين...',
          gradient: 'from-blue-500 to-blue-700',
          bgGradient: 'from-blue-50 via-blue-50/30 to-blue-100/50'
        };
      case 'shifts':
        return {
          icon: Calendar,
          title: title || 'جاري تحميل المناوبات',
          subtitle: subtitle || 'يرجى الانتظار بينما نحضر بيانات المناوبات...',
          gradient: 'from-blue-500 to-blue-700',
          bgGradient: 'from-blue-50 via-blue-50/30 to-blue-100/50'
        };
      case 'settings':
        return {
          icon: Settings,
          title: title || 'جاري تحميل الإعدادات',
          subtitle: subtitle || 'يرجى الانتظار بينما نحضر إعدادات النظام...',
          gradient: 'from-blue-500 to-blue-700',
          bgGradient: 'from-blue-50 via-blue-50/30 to-blue-100/50'
        };
      case 'departments':
        return {
          icon: Building,
          title: title || 'جاري تحميل الإدارات',
          subtitle: subtitle || 'يرجى الانتظار بينما نحضر بيانات الإدارات...',
          gradient: 'from-blue-500 to-blue-700',
          bgGradient: 'from-blue-50 via-blue-50/30 to-blue-100/50'
        };
      case 'ranks':
        return {
          icon: Award,
          title: title || 'جاري تحميل الرتب',
          subtitle: subtitle || 'يرجى الانتظار بينما نحضر بيانات الرتب...',
          gradient: 'from-blue-500 to-blue-700',
          bgGradient: 'from-blue-50 via-blue-50/30 to-blue-100/50'
        };
      case 'dashboard':
        return {
          icon: Database,
          title: title || 'جاري تحميل اللوحة الرئيسية',
          subtitle: subtitle || 'يرجى الانتظار بينما نحضر البيانات...',
          gradient: 'from-blue-500 to-blue-700',
          bgGradient: 'from-blue-50 via-blue-50/30 to-blue-100/50'
        };
      case 'new-shift':
        return {
          icon: Calendar,
          title: title || 'جاري تحضير نظام تسجيل المناوبة',
          subtitle: subtitle || 'يرجى الانتظار بينما نحضر بيانات الموظفين وإعدادات النظام...',
          gradient: 'from-blue-500 to-blue-700',
          bgGradient: 'from-blue-50 via-blue-50/30 to-blue-100/50'
        };
      default:
        return {
          icon: Zap,
          title: title || 'جاري التحميل',
          subtitle: subtitle || 'يرجى الانتظار...',
          gradient: 'from-blue-500 to-blue-700',
          bgGradient: 'from-blue-50 via-blue-50/30 to-blue-100/50'
        };
    }
  };

  const config = getVariantConfig();
  const Icon = CustomIcon || config.icon;

  return (
    <div className={`min-h-screen flex items-center justify-center p-6`}>
      <div className="text-center max-w-md mx-auto">
        {/* الأيقونة الرئيسية مع الحركة */}
        <div className="relative mb-8">
          {/* الدائرة الخارجية المتحركة */}
          <div className={`w-32 h-32 bg-gradient-to-br ${config.gradient} rounded-full flex items-center justify-center mx-auto shadow-2xl relative overflow-hidden animate-float`}>
            {/* تأثير الضوء المتحرك */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse"></div>

            {/* الأيقونة */}
            <Icon className="w-16 h-16 text-white relative z-10" />

            {/* النقاط المتحركة حول الدائرة */}
            <div className="absolute inset-0 animate-spin">
              <div className="absolute top-2 left-1/2 w-2 h-2 bg-white/60 rounded-full transform -translate-x-1/2"></div>
              <div className="absolute bottom-2 left-1/2 w-2 h-2 bg-white/60 rounded-full transform -translate-x-1/2"></div>
              <div className="absolute left-2 top-1/2 w-2 h-2 bg-white/60 rounded-full transform -translate-y-1/2"></div>
              <div className="absolute right-2 top-1/2 w-2 h-2 bg-white/60 rounded-full transform -translate-y-1/2"></div>
            </div>
          </div>

          {/* الدوائر المتحركة في الخلفية */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`w-40 h-40 border-4 border-gradient-to-r ${config.gradient} opacity-20 rounded-full animate-ping`}></div>
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`w-48 h-48 border-2 border-gradient-to-r ${config.gradient} opacity-10 rounded-full animate-pulse`}></div>
          </div>
        </div>

        {/* النص الرئيسي */}
        <div className="space-y-4">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            {config.title}
          </h2>
          <p className="text-lg text-gray-600 leading-relaxed">
            {config.subtitle}
          </p>
        </div>

        {/* شريط التحميل المتحرك */}
        <div className="mt-8 max-w-xs mx-auto">
          <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
            <div className={`h-full bg-gradient-to-r ${config.gradient} rounded-full animate-loading-bar`}>
            </div>
          </div>
        </div>

        {/* النقاط المتحركة */}
        <div className="flex justify-center items-center space-x-2 mt-6" dir="ltr">
          <div className={`w-3 h-3 bg-gradient-to-r ${config.gradient} rounded-full animate-bounce`}
            style={{ animationDelay: `0ms` }}></div>
          <div className={`w-3 h-3 bg-gradient-to-r ${config.gradient} rounded-full animate-bounce`}
            style={{ animationDelay: `150ms` }}></div>
          <div className={`w-3 h-3 bg-gradient-to-r ${config.gradient} rounded-full animate-bounce`}
            style={{ animationDelay: `300ms` }}></div>
        </div>

        {/* رسالة إضافية */}
        <div className="mt-8 p-4 bg-white/60 backdrop-blur-sm rounded-xl border border-white/20 shadow-lg">
          <div className="flex items-center justify-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
            <span className="text-sm font-medium text-gray-700">
              جاري معالجة البيانات...
            </span>
          </div>
        </div>
      </div>

      {/* الجسيمات المتحركة في الخلفية */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className={`absolute w-2 h-2 bg-gradient-to-r ${config.gradient} rounded-full opacity-20`}
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 2}s`
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* CSS للحركات المخصصة */}

    </div>
  );
};

export default LoadingPage;
