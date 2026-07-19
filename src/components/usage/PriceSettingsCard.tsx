import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { ModelPrice } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface PriceSettingsCardProps {
  modelNames: string[];
  modelPrices: Record<string, ModelPrice>;
  onPricesChange: (prices: Record<string, ModelPrice>) => void;
}

// ─── helpers ────────────────────────────────────────────────────────────────

const maxPrice = (prices: Record<string, ModelPrice>): number => {
  let max = 0;
  for (const p of Object.values(prices)) {
    if (p.input > max) max = p.input;
    if (p.output > max) max = p.output;
    if ((p.cached_input ?? p.input) > max) max = p.cached_input ?? p.input;
  }
  return max || 1;
};

const fmt = (v: number) => v.toFixed(4);
const pct = (v: number, max: number) => (max > 0 ? (v / max) * 100 : 0);

// ─── inline edit cell ───────────────────────────────────────────────────────

interface InlineCellProps {
  value: number;
  max: number;
  color: string;
  label: string;
  onSave: (v: number) => void;
}

function InlineCell({ value, max, color, label, onSave }: InlineCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = useCallback(() => {
    const parsed = parseFloat(draft);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      onSave(parsed);
    }
    setEditing(false);
  }, [draft, onSave]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={styles.priceInlineInput}
        type="number"
        step="0.0001"
        min="0"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      />
    );
  }

  return (
    <div
      className={styles.priceCell}
      role="button"
      tabIndex={0}
      title={label}
      onClick={() => { setDraft(fmt(value)); setEditing(true); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setDraft(fmt(value)); setEditing(true); } }}
    >
      <div className={styles.priceBarTrack}>
        <div className={styles.priceBarFill} style={{ width: `${pct(value, max)}%`, backgroundColor: color }} />
      </div>
      <span className={styles.priceCellValue}>{fmt(value)}</span>
    </div>
  );
}

// ─── main component ─────────────────────────────────────────────────────────

export function PriceSettingsCard({
  modelNames,
  modelPrices,
  onPricesChange
}: PriceSettingsCardProps) {
  const { t } = useTranslation();

  // Add form state
  const [selectedModel, setSelectedModel] = useState('');
  const [inputPrice, setInputPrice] = useState('');
  const [outputPrice, setOutputPrice] = useState('');
  const [cachedInputPrice, setCachedInputPrice] = useState('');

  // ─── helpers ────────────────────────────────────────────────────────────

  const maxP = useMemo(() => maxPrice(modelPrices), [modelPrices]);

  const updatePrice = useCallback((model: string, field: keyof ModelPrice, value: number) => {
    const cur = modelPrices[model] ?? { input: 0, output: 0, cached_input: 0 };
    onPricesChange({ ...modelPrices, [model]: { ...cur, [field]: value } });
  }, [modelPrices, onPricesChange]);

  // ─── add new price ──────────────────────────────────────────────────────

  const handleSavePrice = () => {
    if (!selectedModel) return;
    const input = parseFloat(inputPrice) || 0;
    const output = parseFloat(outputPrice) || 0;
    const cached_input = cachedInputPrice.trim() === '' ? input : parseFloat(cachedInputPrice) || 0;
    onPricesChange({ ...modelPrices, [selectedModel]: { input, output, cached_input } });
    setSelectedModel('');
    setInputPrice('');
    setOutputPrice('');
    setCachedInputPrice('');
  };

  const handleDeletePrice = (model: string) => {
    const next = { ...modelPrices };
    delete next[model];
    onPricesChange(next);
  };

  const handleModelSelect = (value: string) => {
    setSelectedModel(value);
    const price = modelPrices[value];
    if (price) {
      setInputPrice(price.input.toString());
      setOutputPrice(price.output.toString());
      setCachedInputPrice(price.cached_input.toString());
    } else {
      setInputPrice('');
      setOutputPrice('');
      setCachedInputPrice('');
    }
  };

  const options = useMemo(
    () => [
      { value: '', label: t('usage_stats.model_price_select_placeholder') },
      ...modelNames.map((name) => ({ value: name, label: name }))
    ],
    [modelNames, t]
  );

  const entries = useMemo(() => Object.entries(modelPrices), [modelPrices]);

  // ─── render ─────────────────────────────────────────────────────────────

  return (
    <Card title={t('usage_stats.model_price_settings')}>
      <div className={styles.pricingSection}>
        {/* Quick actions bar */}
        <div className={styles.priceQuickActions}>
          <span className={styles.priceQuickHint}>{t('usage_stats.model_price_hint')}</span>
        </div>

        {/* Add form (compact row) */}
        <div className={styles.priceForm}>
          <div className={styles.formRow}>
            <div className={styles.formField}>
              <label>{t('usage_stats.model_name')}</label>
              <Select
                value={selectedModel}
                options={options}
                onChange={handleModelSelect}
                placeholder={t('usage_stats.model_price_select_placeholder')}
              />
            </div>
            <div className={styles.formField}>
              <label className={styles.priceLabelInput}>{t('usage_stats.model_price_input')}</label>
              <Input
                type="number"
                value={inputPrice}
                onChange={(e) => setInputPrice(e.target.value)}
                placeholder="0.00"
                step="0.0001"
              />
            </div>
            <div className={styles.formField}>
              <label className={styles.priceLabelOutput}>{t('usage_stats.model_price_output')}</label>
              <Input
                type="number"
                value={outputPrice}
                onChange={(e) => setOutputPrice(e.target.value)}
                placeholder="0.00"
                step="0.0001"
              />
            </div>
            <div className={styles.formField}>
              <label className={styles.priceLabelCached}>{t('usage_stats.model_price_cached_input')}</label>
              <Input
                type="number"
                value={cachedInputPrice}
                onChange={(e) => setCachedInputPrice(e.target.value)}
                placeholder="0.00"
                step="0.0001"
              />
            </div>
            <Button variant="primary" onClick={handleSavePrice} disabled={!selectedModel}>
              {t('common.save')}
            </Button>
          </div>
        </div>

        {/* Advanced data table */}
        <div className={styles.priceTableWrap}>
          {entries.length > 0 ? (
            <table className={styles.priceTable}>
              <thead>
                <tr>
                  <th className={styles.priceThModel}>{t('usage_stats.model_name')}</th>
                  <th className={styles.priceThPrice}>
                    <span className={styles.priceLabelInput}>{t('usage_stats.model_price_input')}</span>
                  </th>
                  <th className={styles.priceThPrice}>
                    <span className={styles.priceLabelOutput}>{t('usage_stats.model_price_output')}</span>
                  </th>
                  <th className={styles.priceThPrice}>
                    <span className={styles.priceLabelCached}>{t('usage_stats.model_price_cached_input')}</span>
                  </th>
                  <th className={styles.priceThAction}>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(([model, price], idx) => (
                  <tr key={model} className={idx % 2 === 0 ? styles.priceRowEven : styles.priceRowOdd}>
                    <td className={styles.priceTdModel}>
                      <span className={styles.priceModelName}>{model}</span>
                    </td>
                    <td className={styles.priceTdPrice}>
                      <InlineCell
                        value={price.input}
                        max={maxP}
                        color="var(--blue-400, #60a5fa)"
                        label={t('usage_stats.model_price_input')}
                        onSave={(v) => updatePrice(model, 'input', v)}
                      />
                    </td>
                    <td className={styles.priceTdPrice}>
                      <InlineCell
                        value={price.output}
                        max={maxP}
                        color="var(--green-400, #4ade80)"
                        label={t('usage_stats.model_price_output')}
                        onSave={(v) => updatePrice(model, 'output', v)}
                      />
                    </td>
                    <td className={styles.priceTdPrice}>
                      <InlineCell
                        value={price.cached_input ?? price.input}
                        max={maxP}
                        color="var(--purple-400, #c084fc)"
                        label={t('usage_stats.model_price_cached_input')}
                        onSave={(v) => updatePrice(model, 'cached_input', v)}
                      />
                    </td>
                    <td className={styles.priceTdAction}>
                      <button
                        className={styles.priceDeleteBtn}
                        onClick={() => handleDeletePrice(model)}
                        title={t('common.delete')}
                        aria-label={`${t('common.delete')} ${model}`}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.hint}>{t('usage_stats.model_price_empty')}</div>
          )}
        </div>
      </div>
    </Card>
  );
}