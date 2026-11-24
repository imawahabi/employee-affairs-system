import React, { useState, useEffect } from 'react';
import { Employee } from '../types';
import { Edit } from 'lucide-react';
import Modal from '../../components/UI/Modal';

interface EditEmployeeModalProps {
  employee: Employee;
  onUpdate: (employee: Partial<Employee>) => void;
  onClose: () => void;
}

const EditEmployeeModal: React.FC<EditEmployeeModalProps> = ({ employee, onUpdate, onClose }) => {
  const [formData, setFormData] = useState({
    full_name: employee.full_name,
    rank: employee.rank,
    file_number: employee.file_number,
    category: employee.category,
  });

  useEffect(() => {
    setFormData({
        full_name: employee.full_name,
        rank: employee.rank,
        file_number: employee.file_number,
        category: employee.category,
    });
  }, [employee]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.full_name?.trim() || !formData.category) {
      alert('يرجى إدخال الاسم الكامل وتحديد الفئة');
      return;
    }
    onUpdate(formData);
  };

  return (
    <Modal isOpen onClose={onClose} title="تعديل بيانات الموظف" size="md">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex items-center gap-4 bg-gradient-to-r from-blue-50 to-blue-100 border border-blue-200 rounded-xl p-4">
          <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center">
            <Edit className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-semibold text-blue-900">تحديث بيانات الموظف</h4>
            <p className="text-sm text-blue-700">عدّل بيانات الموظف الأساسية كما هو مطلوب</p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-700">الاسم الكامل <span className="text-red-500">*</span></label>
          <input
            type="text"
            value={formData.full_name}
            onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white text-right"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-700">المسمى الوظيفي</label>
          <input
            type="text"
            value={formData.rank}
            onChange={(e) => setFormData({ ...formData, rank: e.target.value })}
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white text-right"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-700">رقم الملف</label>
          <input
            type="text"
            value={formData.file_number}
            onChange={(e) => setFormData({ ...formData, file_number: e.target.value })}
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white text-right"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-700">الفئة <span className="text-red-500">*</span></label>
          <select
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value as Employee['category'] })}
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white text-right"
            required
          >
            <option value="قيادات">قيادات</option>
            <option value="مشرفون">مشرفون</option>
            <option value="فني">فني</option>
            <option value="إداري">إداري</option>
          </select>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 transition-colors"
          >
            إلغاء
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            حفظ التغييرات
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default EditEmployeeModal;
