import React from 'react';
import { Calendar, Users, CheckCircle, Clock, Shield, Zap } from 'lucide-react';

interface NewShiftLoadingPageProps {
  title?: string;
  subtitle?: string;
}

const NewShiftLoadingPage: React.FC<NewShiftLoadingPageProps> = ({ 
  title = "جاري تحضير نظام تسجيل المناوبة",
  subtitle = "يرجى الانتظار بينما نحضر بيانات الموظفين وإعدادات النظام..."
}) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50/30 to-blue-100/50 flex items-center justify-center p-6">
      <div className="text-center max-w-lg mx-auto">
        {/* الأيقونة الرئيسية مع التأثيرات */}
        <div className="relative mb-8">
          {/* الدائرة الخارجية المتحركة */}
          <div className="w-40 h-40 bg-gradient-to-br from-blue-500 to-blue-700 rounded-full flex items-center justify-center mx-auto shadow-2xl relative overflow-hidden">
            {/* تأثير الضوء المتحرك */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse"></div>
            
            {/* الأيقونة الرئيسية */}
            <Calendar className="w-20 h-20 text-white relative z-10" />
            
            {/* الأيقونات الدائرية المتحركة */}
            <div className="absolute inset-0 animate-spin" style={{ animationDuration: '8s' }}>
              <div className="absolute top-4 left-1/2 transform -translate-x-1/2">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <Users className="w-4 h-4 text-white" />
                </div>
              </div>
              <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-4 h-4 text-white" />
                </div>
              </div>
              <div className="absolute left-4 top-1/2 transform -translate-y-1/2">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <Clock className="w-4 h-4 text-white" />
                </div>
              </div>
              <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <Shield className="w-4 h-4 text-white" />
                </div>
              </div>
            </div>
          </div>

          {/* الدوائر المتحركة في الخلفية */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-48 h-48 border-4 border-blue-300 opacity-20 rounded-full animate-ping"></div>
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-56 h-56 border-2 border-blue-400 opacity-10 rounded-full animate-pulse"></div>
          </div>
        </div>

        {/* النص الرئيسي */}
        <div className="space-y-4 mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            {title}
          </h2>
          <p className="text-lg text-gray-600 leading-relaxed">
            {subtitle}
          </p>
        </div>

        {/* خطوات التحضير */}
        <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-6 border border-white/20 shadow-lg mb-8">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">جاري التحضير...</h3>
          <div className="space-y-3">
            {[
              { icon: Users, text: "تحميل بيانات الموظفين", delay: "0ms" },
              { icon: Calendar, text: "إعداد نظام التواريخ", delay: "500ms" },
              { icon: CheckCircle, text: "تجهيز واجهة التسجيل", delay: "1000ms" },
              { icon: Shield, text: "التحقق من الصلاحيات", delay: "1500ms" }
            ].map((step, index) => (
              <div 
                key={index}
                className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg"
                style={{ 
                  animation: `fadeInUp 0.6s ease-out ${step.delay} both`
                }}
              >
                <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                  <step.icon className="w-4 h-4 text-white" />
                </div>
                <span className="text-sm font-medium text-gray-700">{step.text}</span>
                <div className="flex-1 flex justify-end">
                  <div className="flex space-x-1" dir="ltr">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: `${index * 200}ms` }}></div>
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: `${index * 200 + 100}ms` }}></div>
                    <div className="w-2 h-2 bg-blue-300 rounded-full animate-bounce" style={{ animationDelay: `${index * 200 + 200}ms` }}></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* شريط التقدم المتحرك */}
        <div className="max-w-xs mx-auto mb-6">
          <div className="bg-gray-200 rounded-full h-3 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 to-blue-700 rounded-full animate-pulse" 
                 style={{
                   animation: 'loading-progress 3s ease-in-out infinite'
                 }}>
            </div>
          </div>
          <p className="text-sm text-gray-600 mt-2">جاري التحضير...</p>
        </div>

        {/* رسالة تشجيعية */}
        <div className="bg-gradient-to-r from-blue-100 to-indigo-100 rounded-xl p-4 border border-blue-200">
          <div className="flex items-center justify-center gap-3">
            <Zap className="w-5 h-5 text-blue-600" />
            <span className="text-sm font-medium text-blue-800">
              سيتم تحضير كل شيء خلال لحظات قليلة
            </span>
          </div>
        </div>
      </div>

      {/* الجسيمات المتحركة في الخلفية */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {[...Array(15)].map((_, i) => (
          <div
            key={i}
            className="absolute w-3 h-3 bg-blue-400 rounded-full opacity-20"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animation: `float-particle ${4 + Math.random() * 6}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 3}s`
            }}
          />
        ))}
      </div>

      {/* CSS للحركات المخصصة */}
      <style>{`
        @keyframes loading-progress {
          0% {
            width: 0%;
            margin-left: 0%;
          }
          50% {
            width: 80%;
            margin-left: 10%;
          }
          100% {
            width: 0%;
            margin-left: 100%;
          }
        }
        
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes float-particle {
          0%, 100% {
            transform: translateY(0px) translateX(0px) scale(1);
            opacity: 0.2;
          }
          25% {
            transform: translateY(-30px) translateX(15px) scale(1.3);
            opacity: 0.4;
          }
          50% {
            transform: translateY(-15px) translateX(-10px) scale(0.9);
            opacity: 0.6;
          }
          75% {
            transform: translateY(-40px) translateX(20px) scale(1.2);
            opacity: 0.3;
          }
        }
      `}</style>
    </div>
  );
};

export default NewShiftLoadingPage;
