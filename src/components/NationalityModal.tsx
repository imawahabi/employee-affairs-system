import React, { useEffect, useState } from 'react';
import { Globe, Save, AlertTriangle } from 'lucide-react';
import Modal from './UI/Modal';
import { Nationality } from '../types';

interface NationalityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (nationality: Omit<Nationality, 'id'> | Nationality) => Promise<void>;
  nationality?: Nationality | null;
  title: string;
}

const NationalityModal: React.FC<NationalityModalProps> = ({
  isOpen,
  onClose,
  onSave,
  nationality,
  title
}) => {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName(nationality?.name || '');
      setError('');
    }
  }, [isOpen, nationality]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('اسم الجنسية مطلوب');
      return;
    }
    try {
      setLoading(true);
      const payload = nationality ? { ...nationality, name: name.trim() } : { name: name.trim() };
      await onSave(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex items-center gap-4 bg-gradient-to-r from-blue-50 to-blue-100 border border-blue-200 rounded-xl p-4">
          <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center">
            <Globe className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-semibold text-blue-900">بيانات الجنسية</h4>
            <p className="text-sm text-blue-700">أدخل اسم الجنسية كما يظهر في الملفات الرسمية</p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-700">
            اسم الجنسية <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError('');
              }}
              className={`w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all ${
                error ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'
              }`}
              placeholder="مثال: سعودي"
              disabled={loading}
              autoFocus
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 transition-colors"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {loading ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default NationalityModal;
