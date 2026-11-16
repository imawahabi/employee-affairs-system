import React, { useMemo, useRef, useState } from 'react';
import { Check, EyeOff, FileText, ListOrdered, RefreshCw, RotateCcw, ShieldCheck, UploadCloud, X } from 'lucide-react';
import {
  analyzePhoneWordFile,
  analyzeForceWordFile,
  analyzeWordFileAuto,
  createBackup,
  createEmployee,
  ForceWordSyncAnalysis,
  ForceWordSyncProposal,
  WordAnalyzeInput,
  updateEmployee
} from '../api';
import { Employee } from '../types';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onApplied: () => void;
};

type ProposalOverride = {
  value?: unknown;
  department?: string;
  section?: string;
};

const formatValue = (value: unknown) => {
  if (value === true) return 'نعم';
  if (value === false) return 'لا';
  if (value === undefined || value === null || value === '') return 'غير مسجل';
  return String(value);
};

const getReasonLabel = (proposal: ForceWordSyncProposal) => {
  if (proposal.action === 'create') return 'اسم غير موجود';
  if (proposal.reason === 'missing_field') return 'بيانات ناقصة';
  return 'اختلاف بيانات';
};

const ForceWordSyncModal: React.FC<Props> = ({ isOpen, onClose, onApplied }) => {
  const [filePath, setFilePath] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ForceWordSyncAnalysis | null>(null);
  const [analysisKind, setAnalysisKind] = useState<'force' | 'phones'>('force');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [showExcluded, setShowExcluded] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, ProposalOverride>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedCount, setAppliedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const visibleProposals = useMemo(
    () => (analysis?.proposals || []).filter((proposal) => (
      showExcluded ? excludedIds.has(proposal.id) : !excludedIds.has(proposal.id)
    )),
    [analysis, excludedIds, showExcluded]
  );

  const activeProposals = useMemo(
    () => (analysis?.proposals || []).filter((proposal) => !excludedIds.has(proposal.id)),
    [analysis, excludedIds]
  );

  const selectedProposals = useMemo(
    () => activeProposals.filter((proposal) => selectedIds.has(proposal.id)),
    [activeProposals, selectedIds]
  );

  const activeOrderProposals = useMemo(
    () => activeProposals.filter((proposal) => proposal.action === 'update' && proposal.field === 'manualOrder'),
    [activeProposals]
  );

  if (!isOpen) return null;

  const resetAnalysisState = () => {
    setAnalysis(null);
    setSelectedIds(new Set());
    setExcludedIds(new Set());
    setShowExcluded(false);
    setOverrides({});
    setAppliedCount(0);
  };

  const selectFile = () => {
    setError(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    if (!/\.(doc|docx)$/i.test(file.name)) {
      setError('الملف يجب أن يكون بصيغة Word .doc أو .docx');
      return;
    }
    setSelectedFile(file);
    setFilePath('');
    setError(null);
    resetAnalysisState();
  };

  const buildAnalyzeInput = async (): Promise<WordAnalyzeInput | null> => {
    if (selectedFile) {
      return { file: selectedFile };
    }
    if (filePath.trim()) return filePath.trim();
    return null;
  };

  const analyzeFile = async (kind: 'auto' | 'force' | 'phones' = 'auto') => {
    setIsAnalyzing(true);
    setError(null);
    setAppliedCount(0);
    try {
      const input = await buildAnalyzeInput();
      if (!input) {
        setError('يرجى اختيار ملف Word أولاً');
        return;
      }
      const result = kind === 'auto'
        ? await analyzeWordFileAuto(input)
        : kind === 'phones'
          ? await analyzePhoneWordFile(input)
          : await analyzeForceWordFile(input);
      setAnalysisKind(result.analysisKind || (kind === 'phones' ? 'phones' : 'force'));
      setAnalysis(result);
      setSelectedIds(new Set());
      setExcludedIds(new Set());
      setShowExcluded(false);
      setOverrides({});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleProposal = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setAllSelected = (checked: boolean) => {
    setSelectedIds(checked ? new Set(activeProposals.map((proposal) => proposal.id)) : new Set());
  };

  const selectOrderProposalsOnly = () => {
    setSelectedIds(new Set(activeOrderProposals.map((proposal) => proposal.id)));
  };

  const excludeProposal = (id: string) => {
    setExcludedIds((current) => new Set(current).add(id));
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const restoreProposal = (id: string) => {
    setExcludedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const updateOverride = (proposalId: string, patch: ProposalOverride) => {
    setOverrides((current) => ({
      ...current,
      [proposalId]: {
        ...(current[proposalId] || {}),
        ...patch
      }
    }));
  };

  const buildUpdatePayload = (proposal: ForceWordSyncProposal): Partial<Employee> => {
    const override = overrides[proposal.id] || {};
    if (!proposal.field) return {};
    const value = override.value !== undefined ? override.value : proposal.suggestedValue;
    return { [proposal.field]: value } as Partial<Employee>;
  };

  const buildCreatePayload = (proposal: ForceWordSyncProposal) => {
    const override = overrides[proposal.id] || {};
    const payload = { ...(proposal.payload || {}) };
    if (override.department !== undefined) payload.department = override.department;
    if (override.section !== undefined) payload.section = override.section;
    return payload;
  };

  const canApplyProposal = (proposal: ForceWordSyncProposal) => {
    if (proposal.action === 'update' && proposal.options?.length) {
      const override = overrides[proposal.id];
      const value = override?.value !== undefined ? override.value : proposal.suggestedValue;
      return value !== undefined && value !== null && value !== '';
    }
    if (proposal.action === 'update' && proposal.field === 'section' && proposal.warning) {
      const override = overrides[proposal.id];
      const value = override?.value !== undefined ? override.value : proposal.suggestedValue;
      return value !== undefined && value !== null && value !== '';
    }
    if (proposal.action !== 'create') return true;
    const payload = buildCreatePayload(proposal);
    return !!payload.department;
  };

  const applyProposals = async (proposals: ForceWordSyncProposal[], emptyMessage: string) => {
    if (!proposals.length) {
      setError(emptyMessage);
      return;
    }
    const blocked = proposals.find((proposal) => !canApplyProposal(proposal));
    if (blocked) {
      setError(blocked.action === 'create'
        ? `اختر الإدارة قبل إضافة: ${blocked.employeeName}`
        : `اختر قيمة من القائمة لحقل ${blocked.label || blocked.field} قبل التطبيق: ${blocked.employeeName}`);
      return;
    }

    setIsApplying(true);
    setError(null);
    setAppliedCount(0);
    try {
      await createBackup();
      let count = 0;
      for (const proposal of proposals) {
        if (proposal.action === 'create') {
          await createEmployee(buildCreatePayload(proposal) as any);
        } else if (proposal.employeeId) {
          await updateEmployee(proposal.employeeId, buildUpdatePayload(proposal));
        }
        count += 1;
        setAppliedCount(count);
      }
      onApplied();
      await analyzeFile(analysisKind);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsApplying(false);
    }
  };

  const applySelected = async () => {
    await applyProposals(selectedProposals, 'اختر تعديل واحد على الأقل');
  };

  const applyWordOrder = async () => {
    await applyProposals(activeOrderProposals, 'لا توجد مقترحات ترتيب حسب كشف Word');
  };

  const renderDepartmentControl = (proposal: ForceWordSyncProposal) => {
    const isCreate = proposal.action === 'create';
    const isDepartment = proposal.field === 'department';
    if (!isCreate && !isDepartment) return null;
    const currentValue = isCreate
      ? (overrides[proposal.id]?.department ?? proposal.payload?.department ?? '')
      : (overrides[proposal.id]?.value ?? proposal.suggestedValue ?? '');
    const options = proposal.options || analysis?.departments || [];
    return (
      <select
        value={String(currentValue || '')}
        onChange={(e) => {
          if (isCreate) updateOverride(proposal.id, { department: e.target.value });
          else updateOverride(proposal.id, { value: e.target.value });
        }}
        className="mt-2 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
      >
        <option value="">اختر الإدارة</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  };

  const renderSectionControl = (proposal: ForceWordSyncProposal) => {
    const isCreate = proposal.action === 'create';
    const isSection = proposal.field === 'section';
    if (!isCreate && !isSection) return null;
    const currentValue = isCreate
      ? (overrides[proposal.id]?.section ?? proposal.payload?.section ?? '')
      : (overrides[proposal.id]?.value ?? proposal.suggestedValue ?? '');
    const options = proposal.sectionOptions || analysis?.sections || [];
    return (
      <select
        value={String(currentValue || '')}
        onChange={(e) => {
          if (isCreate) updateOverride(proposal.id, { section: e.target.value });
          else updateOverride(proposal.id, { value: e.target.value });
        }}
        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
      >
        <option value="">بدون قسم</option>
        {options.map((option) => (
          <option key={`${option.departmentId || ''}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  };

  const renderChoiceControl = (proposal: ForceWordSyncProposal) => {
    if (!proposal.options?.length || proposal.action === 'create' || proposal.field === 'department') return null;
    const currentValue = overrides[proposal.id]?.value ?? proposal.suggestedValue ?? '';
    return (
      <select
        value={String(currentValue || '')}
        onChange={(e) => updateOverride(proposal.id, { value: e.target.value })}
        className="mt-2 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
      >
        <option value="">اختر من القائمة</option>
        {proposal.options.map((option) => (
          <option key={`${option.departmentId || ''}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  };

  const confidenceLabel = (proposal: ForceWordSyncProposal) => {
    if (proposal.confidence === undefined || proposal.confidence === null || proposal.action === 'create') return null;
    return `ثقة ${Math.round(proposal.confidence * 100)}%`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" dir="rtl">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900">مطابقة كشوف Word</h2>
              <p className="text-sm text-slate-500">اختر الملف وسيحدد النظام هل هو كشف قوة أو كشف أرقام هواتف قبل عرض المقترحات.</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-6 py-5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFileChange}
            className="hidden"
          />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
            <button
              type="button"
              onClick={selectFile}
              className="flex items-center justify-between gap-4 rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/60 px-5 py-4 text-right transition hover:border-blue-300 hover:bg-blue-50"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-blue-700 shadow-sm">
                  <UploadCloud className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-sm font-black text-slate-900">
                    {selectedFile ? selectedFile.name : 'اختر ملف Word من الجهاز'}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    يعمل من المتصفح ونسخة سطح المكتب، بدون كتابة مسار الملف يدويًا.
                  </div>
                </div>
              </div>
              <span className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-blue-700 shadow-sm">
                اختيار ملف
              </span>
            </button>
            <button
              onClick={() => analyzeFile('auto')}
              disabled={isAnalyzing}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-sm font-black text-white shadow-lg hover:bg-blue-700 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
              تحليل تلقائي
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs font-bold text-slate-600">
              التحليل التلقائي يقرأ أعمدة الملف واسم الملف لتحديد النوع. استخدم الأزرار التالية فقط إذا أردت فرض نوع التحليل.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => analyzeFile('force')}
                disabled={isAnalyzing}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-60"
              >
                <FileText className="h-3.5 w-3.5" />
                اعتباره كشف قوة
              </button>
              <button
                type="button"
                onClick={() => analyzeFile('phones')}
                disabled={isAnalyzing}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
              >
                <FileText className="h-3.5 w-3.5" />
                اعتباره كشف هواتف
              </button>
            </div>
          </div>

          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}

          {analysis && (
            <>
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                <div className="font-black">
                  تم التعرف على الملف: {analysis.analysisLabel || (analysisKind === 'phones' ? 'كشف أرقام الهواتف' : 'كشف قوة الإدارة العامة')}
                </div>
                {analysis.detectedReason && (
                  <div className="mt-1 text-xs font-semibold text-blue-700">{analysis.detectedReason}</div>
                )}
              </div>

              {!!analysis.warnings?.length && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <div className="mb-2 text-sm font-black text-amber-900">تنبيهات تحتاج مراجعة</div>
                  <div className="space-y-2">
                    {analysis.warnings.map((warning) => (
                      <div
                        key={warning.id}
                        className={`rounded-lg border px-3 py-2 text-xs font-bold ${
                          warning.severity === 'error'
                            ? 'border-red-200 bg-red-50 text-red-800'
                            : 'border-amber-200 bg-white text-amber-800'
                        }`}
                      >
                        {warning.employeeName}: {warning.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <div className="text-xs text-slate-500">تم استخراج</div>
                  <div className="text-2xl font-black text-slate-900">{analysis.parsedEmployees}</div>
                </div>
                <div className="rounded-xl bg-blue-50 px-4 py-3">
                  <div className="text-xs text-blue-600">مقترحات</div>
                  <div className="text-2xl font-black text-blue-700">{analysis.proposals.length}</div>
                </div>
                <div className="rounded-xl bg-emerald-50 px-4 py-3">
                  <div className="text-xs text-emerald-600">محدد</div>
                  <div className="text-2xl font-black text-emerald-700">{selectedIds.size}</div>
                </div>
                <div className="rounded-xl bg-rose-50 px-4 py-3">
                  <div className="text-xs text-rose-600">مستبعد</div>
                  <div className="text-2xl font-black text-rose-700">{excludedIds.size}</div>
                </div>
                <div className="rounded-xl bg-amber-50 px-4 py-3">
                  <div className="text-xs text-amber-600">
                    {analysisKind === 'phones' ? 'غير مطابق من كشف الهواتف' : 'موجود بالقاعدة وغير ظاهر بالكشف'}
                  </div>
                  <div className="text-2xl font-black text-amber-700">{analysis.dbOnlyEmployees.length}</div>
                </div>
                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <div className="text-xs text-slate-500">تم تطبيق</div>
                  <div className="text-2xl font-black text-slate-900">{appliedCount}</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={activeProposals.length > 0 && selectedIds.size === activeProposals.length}
                    onChange={(e) => setAllSelected(e.target.checked)}
                    className="h-4 w-4"
                  />
                  تحديد كل المقترحات غير المستبعدة
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={selectOrderProposalsOnly}
                    disabled={isApplying || activeOrderProposals.length === 0}
                    className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-3 text-sm font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                  >
                    <ListOrdered className="h-4 w-4" />
                    تحديد ترتيب الكشف فقط
                  </button>
                  <button
                    type="button"
                    onClick={applyWordOrder}
                    disabled={isApplying || activeOrderProposals.length === 0}
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
                    title="يطبق مقترحات ترتيب الموظفين حسب ملف Word فقط بدون باقي تعديلات البيانات"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    تطبيق ترتيب الكشف ({activeOrderProposals.length})
                  </button>
                  <button
                    onClick={() => setShowExcluded((current) => !current)}
                    disabled={excludedIds.size === 0}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {showExcluded ? <RotateCcw className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    {showExcluded ? 'عرض المقترحات' : 'عرض المستبعد'}
                  </button>
                  <button
                    onClick={applySelected}
                    disabled={isApplying || selectedIds.size === 0}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    تطبيق المحدد بعد نسخة احتياطية
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {visibleProposals.map((proposal) => (
                  <div key={proposal.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="grid gap-4 lg:grid-cols-[auto_1fr_1fr_1fr] lg:items-start">
                      <div className="space-y-2">
                        {!excludedIds.has(proposal.id) && (
                          <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(proposal.id)}
                              onChange={() => toggleProposal(proposal.id)}
                              className="h-4 w-4"
                            />
                            موافقة
                          </label>
                        )}
                        {excludedIds.has(proposal.id) ? (
                          <button
                            type="button"
                            onClick={() => restoreProposal(proposal.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            استرجاع
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => excludeProposal(proposal.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50"
                          >
                            <EyeOff className="h-3.5 w-3.5" />
                            استبعاد
                          </button>
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-blue-600">{getReasonLabel(proposal)}</div>
                        <div className="mt-1 font-black text-slate-900">{proposal.employeeName}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {proposal.category}{proposal.matchedBy ? ` - مطابق حسب ${proposal.matchedBy}` : ''}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {confidenceLabel(proposal) && (
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700">
                              {confidenceLabel(proposal)}
                            </span>
                          )}
                          {proposal.reviewRequired && (
                            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                              يحتاج مراجعة
                            </span>
                          )}
                        </div>
                        {proposal.matchDetails?.length ? (
                          <div className="mt-2 text-xs leading-5 text-slate-500">
                            {proposal.matchDetails.join('، ')}
                          </div>
                        ) : null}
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3 text-sm">
                        <div className="text-xs font-bold text-slate-500">{proposal.action === 'create' ? 'الموظف غير موجود' : proposal.label}</div>
                        <div className="mt-1 text-slate-700">الحالي: {formatValue(proposal.currentValue)}</div>
                      </div>
                      <div className="rounded-lg bg-blue-50 p-3 text-sm">
                        <div className="text-xs font-bold text-blue-600">المقترح من الكشف</div>
                        <div className="mt-1 font-bold text-blue-900">
                          {proposal.action === 'create'
                            ? `${proposal.sourceEmployee.rank || ''} / ${proposal.sourceEmployee.name}`
                            : formatValue(proposal.suggestedValue)}
                        </div>
                        {renderDepartmentControl(proposal)}
                        {renderSectionControl(proposal)}
                        {renderChoiceControl(proposal)}
                        {proposal.sourceRawValue !== undefined && proposal.sourceRawValue !== null && proposal.sourceRawValue !== '' && (
                          <div className="mt-2 text-xs text-slate-500">القيمة الأصلية: {formatValue(proposal.sourceRawValue)}</div>
                        )}
                        {proposal.warning && <div className="mt-2 text-xs font-bold text-amber-700">{proposal.warning}</div>}
                      </div>
                    </div>
                  </div>
                ))}
                {visibleProposals.length === 0 && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-8 text-center font-bold text-emerald-700">
                    <Check className="mx-auto mb-2 h-6 w-6" />
                    {showExcluded ? 'لا توجد مقترحات مستبعدة.' : 'لا توجد تعديلات مقترحة حسب الحقول المحددة.'}
                  </div>
                )}
              </div>

              {analysis.dbOnlyEmployees.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="mb-2 text-sm font-black text-amber-800">أسماء موجودة في قاعدة البيانات ولم تظهر في الكشف</div>
                  <div className="max-h-40 overflow-y-auto text-sm text-amber-900">
                    {analysis.dbOnlyEmployees.map((employee) => (
                      <div key={employee.id}>
                        {employee.rank ? `${employee.rank} / ` : ''}{employee.name || 'بدون اسم'} - {employee.department || 'بدون إدارة'}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForceWordSyncModal;
