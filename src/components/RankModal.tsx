import React, { useState, useEffect } from 'react';
import { Save, AlertTriangle, Award } from 'lucide-react';
import Modal from './UI/Modal';
import { Rank } from '../types';
import { getRankOrder } from '../utils/rankOrder';

interface RankModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (rank: Omit<Rank, 'id'> | Rank) => Promise<void>;
  rank?: Rank | null;
  title: string;
}

const RankModal: React.FC<RankModalProps> = ({
  isOpen,
  onClose,
  onSave,
  rank,
  title
}) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('ضباط');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const categories = [
    { value: 'ضباط', label: 'ضباط' },
    { value: 'ضباط صف', label: 'ضباط صف' },
    { value: 'مهنيين', label: 'مهنيين' },
    { value: 'مدنيين', label: 'مدنيين' }
  ];

  // Reset form when modal opens/closes or rank changes
  useEffect(() => {
    if (isOpen) {
      setName(rank?.name || '');
      setCategory(rank?.category || 'ضباط');
      setError('');
    }
  }, [isOpen, rank]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      setError('اسم الرتبة مطلوب');
      return;
    }

    if (name.trim().length < 2) {
      setError('اسم الرتبة يجب أن يكون على الأقل حرفين');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const derivedOrder = getRankOrder(name.trim(), category);
      const orderValue = derivedOrder === Number.MAX_SAFE_INTEGER ? 999 : derivedOrder;

      const rankData = rank 
        ? { ...rank, name: name.trim(), category, order: orderValue }
        : { name: name.trim(), category, order: orderValue };
      
      await onSave(rankData);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} size="md">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex items-center gap-4 bg-gradient-to-r from-blue-50 to-blue-100 border border-blue-200 rounded-xl p-4">
          <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-semibold text-blue-900">بيانات الرتبة</h4>
            <p className="text-sm text-blue-700">يتم ترتيب الرتب تلقائياً حسب النظام المعتمد</p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-700">
            اسم الرتبة <span className="text-red-500">*</span>
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
            placeholder="أدخل اسم الرتبة"
            disabled={loading}
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-700">
            الفئة <span className="text-red-500">*</span>
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all bg-white"
            disabled={loading}
          >
            {categories.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

export default RankModal;
