import React, { useEffect, useState } from 'react';
import { Award, Save, AlertTriangle } from 'lucide-react';
import Modal from './UI/Modal';
import { JobTitleEntity } from '../types';

interface JobTitleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (jobTitle: Omit<JobTitleEntity, 'id'> | JobTitleEntity) => Promise<void>;
  jobTitle?: JobTitleEntity | null;
  title: string;
}

const categoryOptions = [
  { value: 'ضباط', label: 'ضباط' },
  { value: 'ضباط صف', label: 'ضباط صف' },
  { value: 'مهنيين', label: 'مهنيين' },
  { value: 'مدنيين', label: 'مدنيين' }
];

const JobTitleModal: React.FC<JobTitleModalProps> = ({
  isOpen,
  onClose,
  onSave,
  jobTitle,
  title
}) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('ضباط');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName(jobTitle?.name || '');
      setCategory(jobTitle?.category || 'ضباط');
      setError('');
    }
  }, [isOpen, jobTitle]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('اسم المسمى / المنصب مطلوب');
      return;
    }
    try {
      setLoading(true);
      const payload = jobTitle
        ? { ...jobTitle, name: name.trim(), category }
        : { name: name.trim(), category };
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
            <Award className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-semibold text-blue-900">بيانات المسمى / المنصب</h4>
            <p className="text-sm text-blue-700">اختر الفئة المناسبة لعرض المسمى لاحقاً في ملف الموظف</p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-700">
            المسمى الوظيفي / المنصب <span className="text-red-500">*</span>
          </label>
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
            placeholder="مثال: قائد وحدة"
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-700">
            الفئة المرتبطة <span className="text-red-500">*</span>
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all bg-white"
            disabled={loading}
          >
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}

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

export default JobTitleModal;
