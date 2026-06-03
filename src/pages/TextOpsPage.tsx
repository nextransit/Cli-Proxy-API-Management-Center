import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as echarts from 'echarts';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import { IconBot, IconBolt, IconChevronDown, IconChevronsRight, IconDatabaseStack } from '@/components/ui/icons';
import { useThemeStore } from '@/stores';
import {
  textOpsApi,
  type TextOpsDisplayBlock,
  type TextOpsQueryResponse,
  type TextOpsRole,
} from '@/services/api';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { secureStorage } from '@/services/storage/secureStorage';
import styles from './TextOpsPage.module.scss';

interface TextOpsRun {
  id: string;
  query: string;
  createdAt: number;
  response?: TextOpsQueryResponse;
  error?: string;
  selectedModel?: string;
  aiEnabled: boolean;
  aiModel: string;
}

interface EChartsOptionBlockProps {
  option: Record<string, unknown>;
}

function EChartsOptionBlock({ option }: EChartsOptionBlockProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const isDark = useThemeStore((state) => state.theme === 'dark');
  const themedOption = useMemo(() => applyCyberChartTheme(option), [option]);

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;

    const chart = echarts.init(element, isDark ? 'dark' : 'light');
    chartInstanceRef.current = chart;
    chart.setOption(themedOption as echarts.EChartsOption, true);

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      if (chartInstanceRef.current === chart) {
        chartInstanceRef.current = null;
      }
    };
  }, [isDark, themedOption]);

  useEffect(() => {
    chartInstanceRef.current?.setOption(themedOption as echarts.EChartsOption, true);
  }, [themedOption]);

  return <div ref={chartRef} className={styles.chartBlock} />;
}

interface RenderContext {
  response?: TextOpsQueryResponse;
  selectedModel?: string;
  onSelectModel?: (model: string | undefined) => void;
}

type TextOpsRecord = Record<string, unknown>;
type TextOpsAITraceTone = 'off' | 'ok' | 'warn' | 'pending';

interface TextOpsAIPhaseState {
  key: 'router' | 'presenter';
  label: string;
  tone: TextOpsAITraceTone;
  detail: string;
}

interface CanvasInsight {
  severity: 'ok' | 'warning' | 'danger';
  body: string;
}

const PLACEHOLDER_QUERY = '查询 5/20-5/31 总的token请求数/token总数/总花费的情况';

const QUICK_CAPABILITIES = [
  '查询今日账单',
  '本周模型消耗 Top 3',
  '近24小时缓存命中率趋势',
  '5/20-5/31 Token 与花费',
];

interface SlashCommand {
  id: string;
  label: string;
  query: string;
  hint: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'today', label: '查询今日账单', query: '查询今日账单', hint: '财务 / 账单' },
  { id: 'top3', label: '本周模型消耗 Top 3', query: '本周模型消耗 Top 3', hint: '流量 / 排行' },
  { id: 'cache', label: '近24小时缓存命中率趋势', query: '近24小时缓存命中率趋势', hint: '缓存 / 调优' },
  { id: 'range', label: '5/20-5/31 Token 与花费', query: '5/20-5/31 Token 与花费', hint: '时间范围统计' },
  { id: 'total', label: '<模型> 总的 token 用量', query: '查询 MiniMax-M3 总的 token 用量', hint: '全量历史聚合' },
  { id: 'finance', label: '财务大盘审计', query: '查询今日账单与异常流量', hint: '费用 / 请求 / 异常来源' },
  { id: 'traffic', label: '流量与能耗统计', query: '分析本周 Token 消耗 Top 3 模型', hint: '模型消耗 / 成功率' },
  { id: 'cacheAudit', label: '智能架构调优', query: '一键诊断全局缓存命中率', hint: '缓存效率 / 延迟' },
];

const ZERO_STATE_CAPABILITIES = [
  {
    key: 'finance',
    title: '财务大盘审计',
    query: '查询今日账单与异常流量',
    detail: '费用、请求、异常来源',
    icon: '💰',
  },
  {
    key: 'traffic',
    title: '流量与能耗统计',
    query: '分析本周 Token 消耗 Top 3 模型',
    detail: '模型消耗、成功率、趋势',
    icon: '📊',
  },
  {
    key: 'cache',
    title: '智能架构调优',
    query: '一键诊断全局缓存命中率',
    detail: '缓存效率、延迟、命中波动',
    icon: '💡',
  },
] as const;

const roleOptions = [
  { value: 'admin', label: 'admin' },
  { value: 'reseller', label: 'reseller' },
  { value: 'customer', label: 'customer' },
] as const;

function parseAllowedUserIDs(raw: string): number[] {
  return raw
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function buildAssistantErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const maybeError = error as { message?: string; details?: unknown };
    if (typeof maybeError.message === 'string' && maybeError.message.trim()) {
      return maybeError.message;
    }
  }
  return '请求失败，请稍后重试。';
}

function hasWarningPrefix(warnings: string[] | undefined, prefix: string): boolean {
  return (warnings || []).some((item) => String(item).startsWith(prefix));
}

// 把 warning 字符串拆成 [prefix, item1, item2, ...]，用来在 UI 里展开成 micro tags。
// 例: "model_price_missing: claude-opus-4-6, deepseek-v4-pro-free"
//   => { prefix: "model_price_missing", items: ["claude-opus-4-6", "deepseek-v4-pro-free"] }
function parseWarningChip(raw: string): { prefix: string; items: string[] } {
  const text = String(raw || '').trim();
  const colonIdx = text.indexOf(':');
  if (colonIdx === -1) {
    return { prefix: text, items: [] };
  }
  const prefix = text.slice(0, colonIdx).trim();
  const rest = text.slice(colonIdx + 1).trim();
  const items = rest
    .split(/[,,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return { prefix, items };
}

// 把 insight markdown 拆成 [key-value pairs, remaining narrative]。
// 识别模式（按优先级）：
//   - `- **Label**: Value`     （无序列表 + 加粗 label）
//   - `**Label**: Value`        （裸加粗 label）
//   - `Label: Value`            （裸 label，要求：label 较短且不含句号）
// 拆分后用 2-col grid 渲染 pairs，剩余文本继续走 MarkdownBlock。
function splitInsightKeyValues(text: string): { pairs: Array<{ label: string; value: string }>; rest: string } {
  const lines = text.split(/\r?\n/);
  const pairs: Array<{ label: string; value: string }> = [];
  const restLines: string[] = [];

  // 行首 list marker: -, *, +, 数字.
  const listMarkerRe = /^\s*(?:[-*+]|\d+[.)])\s+/;
  // 优先匹配 `- **label**: value` / `- **label**：value`
  const boldListRe = /^\s*(?:[-*+]|\d+[.)])\s+\*\*(.+?)\*\*\s*[:：]\s*(.+)$/;
  // 次优：`**label**: value`
  const boldRe = /^\s*\*\*(.+?)\*\*\s*[:：]\s*(.+)$/;
  // 兜底：纯 `label: value`，label 不能有空格太多且 value 不能为空
  const plainRe = /^\s*([^:：\n]{1,18})\s*[:：]\s*(.{2,})$/;

  for (const line of lines) {
    let matched: { label: string; value: string } | null = null;
    let m = line.match(boldListRe);
    if (m) {
      matched = { label: m[1].trim(), value: m[2].trim() };
    } else if (!listMarkerRe.test(line)) {
      m = line.match(boldRe);
      if (m) {
        matched = { label: m[1].trim(), value: m[2].trim() };
      } else {
        m = line.match(plainRe);
        if (m && !/[。.!?！？]$/.test(m[1])) {
          // 排除明显是句子的行（如 "成功率达 90% 即可认为..." 不会进）
          matched = { label: m[1].trim(), value: m[2].trim() };
        }
      }
    }
    if (matched) {
      pairs.push(matched);
    } else {
      restLines.push(line);
    }
  }

  return { pairs, rest: restLines.join('\n').trim() };
}

function getTextOpsRunAIPhases(run: TextOpsRun): TextOpsAIPhaseState[] {
  const model = run.aiModel || '-';
  if (!run.aiEnabled) {
    return [
      { key: 'router', label: 'Router Off', tone: 'off', detail: '未启用 CPA AI，使用本地启发式路由' },
      { key: 'presenter', label: 'Presenter Off', tone: 'off', detail: '未启用 CPA AI，使用本地模板展示' },
    ];
  }
  if (!run.response) {
    const tone: TextOpsAITraceTone = run.error ? 'warn' : 'pending';
    return [
      {
        key: 'router',
        label: run.error ? 'Router Fallback' : 'Router Pending',
        tone,
        detail: run.error ? `${model} 路由未返回可用结果` : `等待 ${model} 路由返回`,
      },
      {
        key: 'presenter',
        label: run.error ? 'Presenter Fallback' : 'Presenter Pending',
        tone,
        detail: run.error ? `${model} 展示增强未返回可用结果` : `等待 ${model} 展示增强`,
      },
    ];
  }

  const warnings = run.response.warnings || [];
  const route = String(run.response.router?.route || '');
  const routerFailed = hasWarningPrefix(warnings, 'router_llm_failed:');
  const presenterFailed = hasWarningPrefix(warnings, 'presenter_llm_failed:');
  const routerActive = !routerFailed && route === 'llm_router';
  const hasPresentation = Boolean(run.response.presentation?.markdown || run.response.presentation?.blocks?.length);

  return [
    routerActive
      ? { key: 'router', label: 'Router AI', tone: 'ok', detail: `${model} 已完成意图路由` }
      : {
          key: 'router',
          label: 'Router Fallback',
          tone: 'warn',
          detail: routerFailed ? `${model} 路由失败，已切到启发式路由` : `当前路由为 ${route || 'heuristic'}，使用启发式路由`,
        },
    presenterFailed
      ? { key: 'presenter', label: 'Presenter Fallback', tone: 'warn', detail: `${model} 展示增强失败，已使用模板结果` }
      : {
          key: 'presenter',
          label: hasPresentation ? 'Presenter AI' : 'Presenter Off',
          tone: hasPresentation ? 'ok' : 'off',
          detail: hasPresentation ? `${model} 已完成展示增强` : '当前响应没有展示增强内容',
        },
  ];
}

function formatRunTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '--:--';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getRunSummary(query: string): string {
  const compact = query.replace(/\s+/g, ' ').trim();
  if (compact.length <= 28) return compact;
  return `${compact.slice(0, 27)}...`;
}

function buildFollowUpQueries(response?: TextOpsQueryResponse): string[] {
  const rows = response?.data?.rows || [];
  const modelRows = rows
    .map((row) => ({
      model: String(row.model_name || ''),
      tokens: asNumber(row.total_tokens) || 0,
      success: asNumber(row.success_rate),
    }))
    .filter((row) => row.model);
  const topModel = [...modelRows].sort((a, b) => b.tokens - a.tokens)[0]?.model;
  const riskyModel = modelRows.find((row) => row.success !== null && row.success < 90)?.model;
  const queries = [
    topModel ? `查看 ${topModel} 近7天 Token 趋势` : '',
    riskyModel ? `排查 ${riskyModel} 最近24小时失败率` : '',
    '近24小时缓存命中率趋势',
  ].filter(Boolean);
  return Array.from(new Set(queries)).slice(0, 3);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asRecordArray(value: unknown): TextOpsRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function applyCyberChartTheme(option: Record<string, unknown>): Record<string, unknown> {
  const series = Array.isArray(option.series)
    ? option.series.map((item, index) => {
        if (!isRecord(item)) return item;
        const type = String(item.type || '');
        if (type === 'bar') {
          return {
            ...item,
            barWidth: item.barWidth || 14,
            itemStyle: {
              ...(isRecord(item.itemStyle) ? item.itemStyle : {}),
              borderRadius: [7, 7, 2, 2],
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: '#67e8f9' },
                { offset: 0.55, color: '#0891b2' },
                { offset: 1, color: 'rgba(8, 145, 178, 0.16)' },
              ]),
              shadowBlur: 14,
              shadowColor: 'rgba(34, 211, 238, 0.24)',
            },
            emphasis: {
              ...(isRecord(item.emphasis) ? item.emphasis : {}),
              focus: 'series',
            },
          };
        }
        if (type === 'line') {
          const itemStyle = isRecord(item.itemStyle) ? item.itemStyle : {};
          const lineStyle = isRecord(item.lineStyle) ? item.lineStyle : {};
          const color = typeof itemStyle.color === 'string'
            ? itemStyle.color
            : typeof lineStyle.color === 'string'
              ? lineStyle.color
              : index % 2 === 0 ? '#67e8f9' : '#a78bfa';
          return {
            ...item,
            smooth: true,
            showSymbol: false,
            itemStyle: {
              ...itemStyle,
              color,
            },
            lineStyle: {
              ...lineStyle,
              width: 2,
              color,
              shadowBlur: 12,
              shadowColor: `${color}66`,
            },
            areaStyle: item.yAxisIndex === 0 ? {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: `${color}30` },
                { offset: 1, color: `${color}00` },
              ]),
            } : item.areaStyle,
          };
        }
        if (type === 'pie') {
          return {
            ...item,
            radius: item.radius || ['54%', '74%'],
            avoidLabelOverlap: true,
            itemStyle: {
              ...(isRecord(item.itemStyle) ? item.itemStyle : {}),
              borderWidth: 2,
              borderColor: 'rgba(15, 23, 42, 0.92)',
              shadowBlur: 16,
              shadowColor: 'rgba(34, 211, 238, 0.18)',
            },
          };
        }
        return item;
      })
    : option.series;

  const themed: Record<string, unknown> = {
    ...option,
    color: ['#67e8f9', '#2dd4bf', '#a78bfa', '#38bdf8', '#22c55e', '#f59e0b'],
    backgroundColor: 'transparent',
    tooltip: {
      ...(isRecord(option.tooltip) ? option.tooltip : {}),
      backgroundColor: 'rgba(15, 23, 42, 0.92)',
      borderColor: 'rgba(103, 232, 249, 0.24)',
      textStyle: { color: '#dbeafe' },
    },
    legend: {
      ...(isRecord(option.legend) ? option.legend : {}),
      textStyle: { color: '#94a3b8' },
      icon: 'roundRect',
    },
    series,
  };

  if (Array.isArray(option.yAxis)) {
    themed.yAxis = option.yAxis.map((axis) => styleCyberAxis(axis));
  } else if (isRecord(option.yAxis)) {
    themed.yAxis = styleCyberAxis(option.yAxis);
  }
  if (Array.isArray(option.xAxis)) {
    themed.xAxis = option.xAxis.map((axis) => styleCyberAxis(axis));
  } else if (isRecord(option.xAxis)) {
    themed.xAxis = styleCyberAxis(option.xAxis);
  }
  return themed;
}

function styleCyberAxis(axis: unknown): unknown {
  if (!isRecord(axis)) return axis;
  return {
    ...axis,
    axisLine: { ...(isRecord(axis.axisLine) ? axis.axisLine : {}), lineStyle: { color: 'rgba(148, 163, 184, 0.28)' } },
    axisLabel: {
      ...(isRecord(axis.axisLabel) ? axis.axisLabel : {}),
      color: '#94a3b8',
      formatter: axis.name === 'Tokens' ? (value: number) => formatCompact(value) : (axis.axisLabel as { formatter?: unknown } | undefined)?.formatter,
    },
    splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.11)', type: 'dashed' } },
    nameTextStyle: { color: '#64748b' },
  };
}

function formatInteger(value: unknown): string {
  const numeric = asNumber(value);
  return numeric === null ? '0' : Math.round(numeric).toLocaleString();
}

function formatCompact(value: unknown): string {
  const numeric = asNumber(value);
  if (numeric === null) return '0';
  const abs = Math.abs(numeric);
  if (abs >= 1_000_000_000) return `${(numeric / 1_000_000_000).toFixed(2)} B`;
  if (abs >= 1_000_000) return `${(numeric / 1_000_000).toFixed(2)} M`;
  if (abs >= 1_000) return `${(numeric / 1_000).toFixed(2)} K`;
  return abs >= 1 ? Math.round(numeric).toLocaleString() : numeric.toFixed(2);
}

function formatPercent(value: unknown): string {
  const numeric = asNumber(value);
  return numeric === null ? '0.00%' : `${numeric.toFixed(2)}%`;
}

function formatCurrency(value: unknown): string {
  const numeric = asNumber(value);
  if (numeric === null || numeric <= 0) return '$0.00';
  const digits = numeric < 0.01 ? 4 : 2;
  return `$${numeric.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatCell(value: unknown, format?: unknown): string {
  if (format === 'integer') return formatInteger(value);
  if (format === 'compact') return formatCompact(value);
  if (format === 'percent') return formatPercent(value);
  if (format === 'currency') return formatCurrency(value);
  if (value === null || value === undefined || value === '') return '0';
  return String(value);
}

function inlineMarkdown(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('__') && part.endsWith('__')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return <span key={index}>{part}</span>;
  });
}

function parseMarkdownTable(lines: string[], startIndex: number) {
  const tableLines: string[] = [];
  let cursor = startIndex;
  while (cursor < lines.length && /^\s*\|.*\|\s*$/.test(lines[cursor])) {
    tableLines.push(lines[cursor]);
    cursor += 1;
  }
  const rows = tableLines.map((line) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim()),
  );
  const headers = rows[0] || [];
  const body = rows.slice(1).filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
  return { headers, body, nextIndex: cursor };
}

function nextMeaningfulMarkdownLine(lines: string[], startIndex: number): string {
  for (let cursor = startIndex; cursor < lines.length; cursor += 1) {
    const line = lines[cursor].trim();
    if (line) return line;
  }
  return '';
}

function isPlainMarkdownSectionTitle(line: string, nextLine: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 18) return false;
  if (/^(#{1,4}\s+|\*\*|__|\s*[-*]\s+|\s*\d+[.)]\s+|\s*\|)/.test(trimmed)) return false;
  if (/[。！？!?.,，:：；;]$/.test(trimmed)) return false;
  return /^(#{1,4}\s+|\*\*|__|\s*[-*]\s+|\s*\d+[.)]\s+|\s*\|)/.test(nextLine.trim());
}

type OpsSectionKind = 'metrics' | 'risks' | 'actions' | 'trace' | 'default';
type RiskTone = 'crit' | 'warn' | 'info';

interface ParsedOpsSection {
  title: string;
  kind: OpsSectionKind;
  lines: string[];
}

interface MetricRow {
  key: string;
  value: string;
}

interface RiskItem {
  text: string;
  details: string[];
  tone: RiskTone;
}

const OPS_SECTION_LABELS: Record<OpsSectionKind, string> = {
  metrics: 'METRICS',
  risks: 'RISKS',
  actions: 'ACTIONS',
  trace: 'TRACE',
  default: 'DETAIL',
};

function stripMarkdownDecorators(text: string): string {
  return text
    .replace(/^#{1,4}\s+/, '')
    .replace(/^[>\s]+/, '')
    .replace(/^[\-*]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/^[^\w\u4e00-\u9fff\[]+/, '')
    .trim();
}

function cleanListPrefix(text: string): string {
  return text.trim().replace(/^[\-*]\s+/, '').replace(/^\d+[.)]\s+/, '').trim();
}

function extractSectionTitle(line: string, nextLine: string): string | null {
  const heading = line.match(/^(#{1,4})\s+(.+)$/);
  if (heading) return stripMarkdownDecorators(heading[2]);

  const clean = stripMarkdownDecorators(line);
  if (!clean || clean.length > 34) return null;
  if (/^(关键结果|核心结果|风险项|风险提示|风险排查|下一步行动|后续操作|行动建议|执行链路|AI Execution Trace|Trace|Metrics|Risks|Actions|Next Actions|Insight Summary|Token 消费报告)$/i.test(clean)) {
    return clean;
  }
  if (isPlainMarkdownSectionTitle(line, nextLine)) return clean;
  return null;
}

function classifyOpsSection(title: string): OpsSectionKind {
  const normalized = title.toLowerCase();
  if (/风险|risk|异常|告警|限流|失败/.test(normalized)) return 'risks';
  if (/行动|下一步|后续|建议|actions|next|todo/.test(normalized)) return 'actions';
  if (/trace|链路|router|presenter|执行/.test(normalized)) return 'trace';
  if (/关键|核心|metric|统计|token|消费|账单|result|summary|概览/.test(normalized)) return 'metrics';
  return 'default';
}

function parseOpsSections(text: string): ParsedOpsSection[] {
  const lines = text.split(/\r?\n/);
  const sections: ParsedOpsSection[] = [];
  let current: ParsedOpsSection = { title: '', kind: 'default', lines: [] };

  const flush = () => {
    const hasBody = current.lines.some((line) => line.trim());
    if (hasBody) {
      sections.push({
        ...current,
        lines: [...current.lines],
      });
    }
  };

  lines.forEach((line, index) => {
    const title = extractSectionTitle(line, nextMeaningfulMarkdownLine(lines, index + 1));
    if (title) {
      flush();
      current = { title, kind: classifyOpsSection(title), lines: [] };
      return;
    }
    current.lines.push(line);
  });
  flush();

  return sections.filter((section) => section.title || section.lines.some((line) => line.trim()));
}

function parseMetricLine(line: string): MetricRow | null {
  const clean = cleanListPrefix(stripMarkdownDecorators(line));
  if (!clean || clean.length > 90) return null;
  const match = clean.match(/^(.{2,28}?)\s*[:：]\s*(.+)$/);
  if (!match) return null;
  const key = match[1].trim();
  const value = match[2].trim();
  if (!key || !value) return null;
  return { key, value };
}

function splitMetricLines(lines: string[]): { metrics: MetricRow[]; rest: string[] } {
  const metrics: MetricRow[] = [];
  const rest: string[] = [];
  lines.forEach((line) => {
    if (!line.trim()) {
      rest.push(line);
      return;
    }
    const metric = parseMetricLine(line);
    if (metric) {
      metrics.push(metric);
    } else {
      rest.push(line);
    }
  });
  return { metrics, rest };
}

function parseHumanNumber(value: string): number | null {
  const normalized = value.replace(/,/g, '').trim();
  const match = normalized.match(/(-?\d+(?:\.\d+)?)\s*(亿|万|b|m|k)?/i);
  if (!match) return null;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return null;
  const unit = (match[2] || '').toLowerCase();
  if (unit === '亿') return raw * 100_000_000;
  if (unit === '万') return raw * 10_000;
  if (unit === 'b') return raw * 1_000_000_000;
  if (unit === 'm') return raw * 1_000_000;
  if (unit === 'k') return raw * 1_000;
  return raw;
}

function buildTokenShare(metrics: MetricRow[]): { input: number; output: number } | null {
  const input = metrics.find((item) => /输入|input/i.test(item.key));
  const output = metrics.find((item) => /输出|output/i.test(item.key));
  if (!input || !output) return null;
  const inputValue = parseHumanNumber(input.value);
  const outputValue = parseHumanNumber(output.value);
  if (inputValue === null || outputValue === null || inputValue + outputValue <= 0) return null;
  return { input: inputValue, output: outputValue };
}

function classifyRiskTone(text: string): RiskTone {
  const normalized = stripMarkdownDecorators(text).toLowerCase();
  if (/crit|critical|高危|严重|429|rate limit|限流|配额|耗尽|disabled|unauthorized|401|404|失败请求集中|调用失败|key/.test(normalized)) {
    return 'crit';
  }
  if (/warn|warning|中危|异常|偏低|波动|成功率|命中率|失败|无数据|延迟/.test(normalized)) {
    return 'warn';
  }
  return 'info';
}

function parseRiskItems(lines: string[]): RiskItem[] {
  const items: RiskItem[] = [];
  let current: RiskItem | null = null;
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const clean = cleanListPrefix(trimmed);
    const plain = stripMarkdownDecorators(clean);
    const startsNew = /^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line) || /^(\[?(crit|warn|info)\]?|高危|中危|低危|严重|警告|提示)/i.test(plain);
    if (startsNew || !current) {
      current = { text: clean, details: [], tone: classifyRiskTone(clean) };
      items.push(current);
      return;
    }
    current.details.push(clean);
    current.tone = current.tone === 'crit' ? 'crit' : classifyRiskTone(`${current.text} ${clean}`);
  });
  return items;
}

function parseActionItems(lines: string[]): string[] {
  return lines
    .map((line) => cleanListPrefix(line))
    .filter((line) => line && !/^[:：]/.test(line) && !/^(可能原因|备注|说明)\s*[:：]?$/.test(stripMarkdownDecorators(line)));
}

function renderMetricDashboard(lines: string[], keyPrefix: string): ReactNode {
  const { metrics, rest } = splitMetricLines(lines);
  const share = buildTokenShare(metrics);
  const total = share ? share.input + share.output : 0;
  const inputPercent = share ? Math.max(0, Math.min(100, (share.input / total) * 100)) : 0;

  return (
    <>
      {metrics.length >= 2 ? (
        <div className={styles.metricGrid}>
          {metrics.map((metric, index) => (
            <div key={`${keyPrefix}-metric-${metric.key}-${index}`} className={styles.metricCell}>
              <span>{metric.key}</span>
              <strong>{inlineMarkdown(metric.value)}</strong>
            </div>
          ))}
          {share ? (
            <div className={styles.metricShare}>
              <div>
                <span>INPUT</span>
                <strong>{inputPercent.toFixed(1)}%</strong>
              </div>
              <div className={styles.metricShareTrack} aria-hidden="true">
                <span style={{ width: `${inputPercent}%` }} />
              </div>
              <div>
                <span>OUTPUT</span>
                <strong>{(100 - inputPercent).toFixed(1)}%</strong>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {rest.some((line) => line.trim()) ? <div className={styles.markdownBlockCompact}>{renderBasicMarkdownNodes(rest, `${keyPrefix}-rest`)}</div> : null}
    </>
  );
}

function renderRiskDashboard(lines: string[], keyPrefix: string): ReactNode {
  const risks = parseRiskItems(lines);
  if (!risks.length) {
    return <div className={styles.markdownBlockCompact}>{renderBasicMarkdownNodes(lines, keyPrefix)}</div>;
  }
  return (
    <div className={styles.riskList}>
      {risks.map((risk, index) => (
        <div key={`${keyPrefix}-risk-${index}`} className={`${styles.riskItem} ${styles[`riskItem_${risk.tone}`] || ''}`}>
          <div className={styles.riskHeader}>
            <span>[{risk.tone.toUpperCase()}]</span>
            <strong>{inlineMarkdown(risk.text)}</strong>
          </div>
          {risk.details.length ? (
            <div className={styles.riskDetail}>
              {risk.details.map((detail, detailIndex) => (
                <small key={`${detail}-${detailIndex}`}>{inlineMarkdown(detail)}</small>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function renderActionDashboard(lines: string[], keyPrefix: string): ReactNode {
  const actions = parseActionItems(lines);
  if (!actions.length) {
    return <div className={styles.markdownBlockCompact}>{renderBasicMarkdownNodes(lines, keyPrefix)}</div>;
  }
  return (
    <div className={styles.actionList}>
      {actions.map((action, index) => (
        <div key={`${keyPrefix}-action-${index}`} className={styles.actionItem}>
          <span className={styles.actionBox} aria-hidden="true" />
          <div>
            <strong>{String(index + 1).padStart(2, '0')}</strong>
            <span>{inlineMarkdown(action)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function sectionBadge(section: ParsedOpsSection): string {
  if (section.kind === 'risks') {
    const risks = parseRiskItems(section.lines);
    const crit = risks.filter((risk) => risk.tone === 'crit').length;
    return crit > 0 ? `${crit} CRIT` : `${risks.length} SIGNAL`;
  }
  if (section.kind === 'actions') return `${parseActionItems(section.lines).length} TODO`;
  if (section.kind === 'metrics') return `${splitMetricLines(section.lines).metrics.length} KV`;
  return OPS_SECTION_LABELS[section.kind];
}

function OpsMarkdownSection({ section, index }: { section: ParsedOpsSection; index: number }) {
  const [open, setOpen] = useState(section.kind !== 'default' || index === 0);
  const body =
    section.kind === 'metrics'
      ? renderMetricDashboard(section.lines, `ops-${index}`)
      : section.kind === 'risks'
        ? renderRiskDashboard(section.lines, `ops-${index}`)
        : section.kind === 'actions'
          ? renderActionDashboard(section.lines, `ops-${index}`)
          : <div className={styles.markdownBlockCompact}>{renderBasicMarkdownNodes(section.lines, `ops-${index}`)}</div>;

  return (
    <section className={`${styles.opsSection} ${styles[`opsSection_${section.kind}`] || ''}`}>
      <button type="button" className={styles.opsSectionHeader} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className={styles.opsSectionKicker}>{OPS_SECTION_LABELS[section.kind]}</span>
        <strong>{section.title || OPS_SECTION_LABELS[section.kind]}</strong>
        <em>{sectionBadge(section)}</em>
        <IconChevronDown className={`${styles.opsSectionChevron} ${open ? styles.opsSectionChevronOpen : ''}`} size={14} />
      </button>
      {open ? <div className={styles.opsSectionBody}>{body}</div> : null}
    </section>
  );
}

function renderBasicMarkdownNodes(lines: string[], keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const table = parseMarkdownTable(lines, index);
      nodes.push(
        <div key={`${keyPrefix}-table-${index}`} className={styles.markdownTableWrap}>
          <table className={styles.markdownTable}>
            <thead>
              <tr>
                {table.headers.map((header, cellIndex) => (
                  <th key={`${header}-${cellIndex}`}>{inlineMarkdown(header)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.body.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${cell}-${cellIndex}`}>{inlineMarkdown(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      index = table.nextIndex;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const Tag = `h${Math.min(heading[1].length + 2, 5)}` as 'h3' | 'h4' | 'h5';
      nodes.push(<Tag key={`${keyPrefix}-heading-${index}`}>{inlineMarkdown(heading[2])}</Tag>);
      index += 1;
      continue;
    }
    if (/^\s*-{3,}\s*$/.test(line)) {
      nodes.push(<hr key={`${keyPrefix}-hr-${index}`} />);
      index += 1;
      continue;
    }
    if (isPlainMarkdownSectionTitle(line, nextMeaningfulMarkdownLine(lines, index + 1))) {
      nodes.push(<h3 key={`${keyPrefix}-section-${index}`}>{inlineMarkdown(line)}</h3>);
      index += 1;
      continue;
    }
    if (/^\s*-\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*-\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*-\s+/, ''));
        index += 1;
      }
      nodes.push(
        <ul key={`${keyPrefix}-list-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>{inlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ''));
        index += 1;
      }
      nodes.push(
        <ol key={`${keyPrefix}-ordered-list-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>{inlineMarkdown(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    nodes.push(<p key={`${keyPrefix}-p-${index}`}>{inlineMarkdown(line)}</p>);
    index += 1;
  }

  return nodes;
}

function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const sections = parseOpsSections(text);
  const useOpsLayout = sections.length > 1 || sections.some((section) => section.kind !== 'default');

  if (useOpsLayout) {
    return (
      <div className={styles.opsMarkdownBlock}>
        {sections.map((section, index) => (
          <OpsMarkdownSection key={`${section.title || 'section'}-${index}`} section={section} index={index} />
        ))}
      </div>
    );
  }

  const nodes = renderBasicMarkdownNodes(lines, 'root');
  return <div className={styles.markdownBlock}>{nodes}</div>;
}

function normalizeQueryResponseFromError(error: unknown): TextOpsQueryResponse | null {
  if (!isRecord(error)) return null;
  const details = (error as { details?: unknown }).details;
  if (!isRecord(details)) return null;
  if (!('router' in details) || !('guardrail' in details)) return null;
  return details as unknown as TextOpsQueryResponse;
}

function buildTrendOption(response?: TextOpsQueryResponse, selectedModel?: string): Record<string, unknown> | null {
  const raw = response?.data?.raw;
  if (!isRecord(raw)) return null;
  const sourceRows = selectedModel
    ? asRecordArray(raw.daily_model_series).filter((row) => String(row.model_name || '') === selectedModel)
    : asRecordArray(raw.daily_metrics);
  if (sourceRows.length === 0) return null;
  const rows = [...sourceRows].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const labels = rows.map((row) => String(row.date || ''));
  return {
    legend: { top: 0, right: 0 },
    grid: { left: 58, right: 54, top: 46, bottom: 34 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'category', data: labels },
    yAxis: [
      { type: 'value', name: 'Tokens' },
      { type: 'value', name: '%', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
    ],
    series: [
      {
        name: selectedModel ? `${selectedModel} Tokens` : 'Token Consumption',
        type: 'bar',
        yAxisIndex: 0,
        data: rows.map((row) => asNumber(row.total_tokens) || 0),
      },
      {
        name: 'Success %',
        type: 'line',
        smooth: true,
        showSymbol: false,
        yAxisIndex: 1,
        itemStyle: { color: '#22c55e' },
        lineStyle: { color: '#22c55e' },
        data: rows.map((row) => asNumber(row.success_rate) || 0),
      },
      {
        name: 'Cache Hit %',
        type: 'line',
        smooth: true,
        showSymbol: false,
        yAxisIndex: 1,
        itemStyle: { color: '#a78bfa' },
        lineStyle: { color: '#a78bfa' },
        data: rows.map((row) => asNumber(row.cache_hit_rate) || 0),
      },
    ],
  };
}

function getModelTrendValues(response: TextOpsQueryResponse | undefined, model: string): number[] {
  const raw = response?.data?.raw;
  if (!isRecord(raw) || !model) return [];
  return asRecordArray(raw.daily_model_series)
    .filter((row) => String(row.model_name || '') === model)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    .map((row) => asNumber(row.total_tokens) || 0);
}

function buildSparklinePoints(values: number[], width = 96, height = 28): string {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return '';
  const series = clean.length === 1 ? [clean[0], clean[0]] : clean;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = Math.max(max - min, 1);
  return series
    .map((value, index) => {
      const x = (index / Math.max(series.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function MiniSparkline({ values, active }: { values: number[]; active: boolean }) {
  const points = buildSparklinePoints(values);
  return (
    <svg className={`${styles.sparkline} ${active ? styles.sparklineActive : ''}`} viewBox="0 0 96 28" role="img" aria-label="trend">
      <defs>
        <linearGradient id="text-ops-sparkline" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.2" />
          <stop offset="55%" stopColor="#67e8f9" stopOpacity="1" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <line x1="0" x2="96" y1="24" y2="24" className={styles.sparklineRail} />
      {points ? <polyline points={points} className={styles.sparklinePath} /> : <line x1="8" x2="88" y1="14" y2="14" className={styles.sparklinePath} />}
    </svg>
  );
}

function renderKpiCards(block: TextOpsDisplayBlock, index: number) {
  const cards = asRecordArray(block.data);
  if (cards.length === 0) return null;
  return (
    <div key={`kpi-${index}`} className={styles.kpiGrid}>
      {cards.map((card) => {
        const status = String(card.status || 'neutral');
        return (
          <div key={String(card.key || card.label)} className={`${styles.kpiCard} ${styles[`status_${status}`] || ''}`}>
            <div className={styles.kpiLabel}>{String(card.label || card.key || '')}</div>
            <div className={styles.kpiValue}>{formatCell(card.value, card.format)}</div>
          </div>
        );
      })}
    </div>
  );
}

function buildDiagnosticInsight(response?: TextOpsQueryResponse): CanvasInsight | null {
  const rows = (response?.data?.rows || [])
    .map((row) => ({
      model: String(row.model_name || ''),
      tokens: asNumber(row.total_tokens) || 0,
      success: asNumber(row.success_rate),
      cacheHit: asNumber(row.cache_hit_rate),
    }))
    .filter((row) => row.model);
  if (rows.length === 0 && !response?.data?.summary) return null;

  const risky = rows
    .filter((row) => row.success !== null && row.success < 90)
    .sort((a, b) => (a.success || 0) - (b.success || 0))[0];
  const topModel = [...rows].sort((a, b) => b.tokens - a.tokens)[0];
  const summary = response?.data?.summary || {};
  const totalTokens = asNumber(summary.total_tokens) || rows.reduce((sum, row) => sum + row.tokens, 0);
  const successRate = asNumber(summary.success_rate);
  const cacheHitRate = asNumber(summary.cache_hit_rate);
  const topShare = topModel && totalTokens > 0 ? (topModel.tokens / totalTokens) * 100 : null;
  const bodyParts: string[] = [];

  if (risky) {
    bodyParts.push(`检测到 ${risky.model} 成功率 ${formatPercent(risky.success)} 低于 90%，应优先排查失败与重试链路。`);
  } else if (successRate !== null) {
    bodyParts.push(`当前整体成功率 ${formatPercent(successRate)}，暂未发现低于 90% 的模型异常。`);
  }
  if (topModel) {
    bodyParts.push(`${topModel.model} 消耗 ${formatCompact(topModel.tokens)} Token${topShare !== null ? `，占总量 ${formatPercent(topShare)}` : ''}。`);
  }
  if (cacheHitRate !== null) {
    bodyParts.push(`缓存命中率 ${formatPercent(cacheHitRate)}${topModel?.cacheHit !== null && topModel?.cacheHit !== undefined ? `，主力模型命中率 ${formatPercent(topModel.cacheHit)}` : ''}。`);
  }

  return {
    severity: risky ? (risky.success !== null && risky.success < 50 ? 'danger' : 'warning') : 'ok',
    body: bodyParts.join(' '),
  };
}

function renderInsightBody(body: string) {
  // Wrap recognised tokens (model ids, percent values) in tag chips for a higher-signal readout.
  // Model id pattern allows slashes so namespaced ids like `minimaxai/minimax-m2.7` match.
  const tokenRegex = /([A-Za-z][A-Za-z0-9._/-]*-[A-Za-z0-9._/-]+|\d+(?:\.\d+)?%)/g;
  const parts = body.split(tokenRegex);
  return parts.map((part, index) => {
    if (/^[A-Za-z][A-Za-z0-9._/-]*-[A-Za-z0-9._/-]+$/.test(part)) {
      return (
        <span key={index} className={styles.insightChipModel}>
          {part}
        </span>
      );
    }
    if (/^\d+(?:\.\d+)?%$/.test(part)) {
      return (
        <span key={index} className={styles.insightChipPercent}>
          {part}
        </span>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

function renderCanvasInsight(context: RenderContext) {
  const insight = buildDiagnosticInsight(context.response);
  if (!insight) return null;
  return (
    <section className={`${styles.canvasInsight} ${styles[`insight_${insight.severity}`] || ''}`}>
      <div className={styles.insightIcon}>
        <IconBot size={16} />
      </div>
      <div className={styles.insightContent}>
        <div className={styles.insightTitle}>AI Diagnostic Insight</div>
        <p>{renderInsightBody(insight.body)}</p>
      </div>
    </section>
  );
}

function renderDataTable(block: TextOpsDisplayBlock, index: number, context: RenderContext) {
  if (!isRecord(block.data)) return null;
  const columns = asRecordArray(block.data.columns);
  const rows = asRecordArray(block.data.rows);
  if (columns.length === 0 || rows.length === 0) return null;
  return (
    <div key={`table-${index}`} className={styles.blockWrapper}>
      {block.title ? (
        <div className={styles.blockTitle}>
          <span>{block.title}</span>
          <span className={styles.tableHint}>7D micro trend</span>
        </div>
      ) : null}
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              {columns.map((column) => {
                const key = String(column.key);
                return (
                  <th
                    key={key}
                    className={column.align === 'right' ? styles.alignRight : column.align === 'center' ? styles.alignCenter : undefined}
                  >
                    {key === 'trend' ? '7D' : String(column.label || column.key)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const model = String(row.model_name || '');
              const selected = context.selectedModel === model;
              const successRate = asNumber(row.success_rate);
              const isRiskyRow = successRate !== null && successRate < 90;
              return (
                <tr
                  key={model}
                  className={`${isRiskyRow ? styles.dangerRow : ''} ${selected ? styles.selectedRow : ''}`}
                  onClick={() => context.onSelectModel?.(selected ? undefined : model)}
                >
                  {columns.map((column) => {
                    const key = String(column.key);
                    if (key === 'trend') {
                      const trendValues = getModelTrendValues(context.response, model);
                      return (
                        <td key={key} className={styles.alignCenter}>
                          <button type="button" className={`${styles.trendButton} ${styles.trendSparkButton}`} aria-label={selected ? 'Show all models' : `Show ${model} trend`}>
                            <MiniSparkline values={trendValues} active={selected} />
                            {selected ? <span className={styles.trendReset}>All</span> : null}
                          </button>
                        </td>
                      );
                    }
                    const value = row[key];
                    const numeric = asNumber(value);
                    const warnBelow = asNumber(column.warn_below);
                    const isDanger = warnBelow !== null && numeric !== null && numeric < warnBelow;
                    const cellClass = `${column.align === 'right' ? styles.alignRight : column.align === 'center' ? styles.alignCenter : ''} ${isDanger ? styles.dangerCell : ''}`;
                    if (key === 'model_name') {
                      return (
                        <td key={key} className={cellClass}>
                          <span className={styles.modelNameCell}>
                            <span className={`${styles.modelStatusDot} ${isRiskyRow ? styles.modelStatusDanger : styles.modelStatusOk}`} aria-hidden="true" />
                            {formatCell(value, column.format)}
                          </span>
                        </td>
                      );
                    }
                    if (key === 'success_rate') {
                      return (
                        <td key={key} className={cellClass}>
                          <span className={`${styles.successPill} ${isDanger ? styles.successPillDanger : ''}`}>
                            {formatCell(value, column.format)}
                          </span>
                        </td>
                      );
                    }
                    return (
                      <td key={key} className={cellClass}>
                        {column.progress ? (
                          <div className={styles.progressCell}>
                            <span>{formatCell(value, column.format)}</span>
                            <span className={styles.progressTrack}>
                              <span className={styles.progressBar} style={{ width: `${Math.max(0, Math.min(100, numeric || 0))}%` }} />
                            </span>
                          </div>
                        ) : (
                          formatCell(value, column.format)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderDisplayBlock(block: TextOpsDisplayBlock, index: number, context: RenderContext) {
  if (block.type === 'KPI_CARDS') {
    return renderKpiCards(block, index);
  }
  if (block.type === 'DATA_TABLE') {
    return renderDataTable(block, index, context);
  }
  if (block.type === 'ECHARTS_OPTION' && isRecord(block.data)) {
    const dynamicTrend = String(block.title || '').toLowerCase().includes('trend')
      ? buildTrendOption(context.response, context.selectedModel)
      : null;
    return (
      <div key={`chart-${index}`} className={styles.blockWrapper}>
        {block.title ? (
          <div className={styles.blockTitle}>
            <span>{block.title}</span>
            {context.selectedModel && dynamicTrend ? (
              <button type="button" className={styles.clearFilterButton} onClick={() => context.onSelectModel?.(undefined)}>
                {context.selectedModel}
              </button>
            ) : null}
          </div>
        ) : null}
        <EChartsOptionBlock option={dynamicTrend || block.data} />
      </div>
    );
  }
  if (typeof block.data === 'string') {
    const isSummary = block.type === 'MARKDOWN';
    return (
      <div key={`text-${index}`} className={`${styles.blockWrapper} ${isSummary ? styles.summaryBlock : ''}`}>
        {block.title ? <div className={styles.blockTitle}>{block.title}</div> : null}
        <MarkdownBlock text={block.data} />
      </div>
    );
  }
  return (
    <div key={`json-${index}`} className={styles.blockWrapper}>
      {block.title ? <div className={styles.blockTitle}>{block.title}</div> : null}
      <pre className={styles.markdownBlock}>{JSON.stringify(block.data, null, 2)}</pre>
    </div>
  );
}

function renderCanvasBlocks(blocks: TextOpsDisplayBlock[], context: RenderContext) {
  const indexed = blocks.map((block, index) => ({ block, index }));
  const kpis = indexed.filter((item) => item.block.type === 'KPI_CARDS');
  const charts = indexed.filter((item) => item.block.type === 'ECHARTS_OPTION');
  const primaryChart = charts.find((item) => String(item.block.title || '').toLowerCase().includes('trend')) || charts[0];
  const secondaryCharts = charts.filter((item) => item !== primaryChart);
  const tables = indexed.filter((item) => item.block.type === 'DATA_TABLE');
  const rest = indexed.filter((item) => !['KPI_CARDS', 'ECHARTS_OPTION', 'DATA_TABLE'].includes(item.block.type));

  return (
    <div className={styles.canvasLayout}>
      {renderCanvasInsight(context)}
      {kpis.length ? <div className={styles.canvasKpis}>{kpis.map((item) => renderDisplayBlock(item.block, item.index, context))}</div> : null}
      {primaryChart || tables.length ? (
        <div className={styles.canvasMainGrid}>
          {primaryChart ? <div className={styles.canvasTrend}>{renderDisplayBlock(primaryChart.block, primaryChart.index, context)}</div> : null}
          {tables.length ? <div className={styles.canvasDetails}>{tables.map((item) => renderDisplayBlock(item.block, item.index, context))}</div> : null}
        </div>
      ) : null}
      {secondaryCharts.length ? <div className={styles.canvasCharts}>{secondaryCharts.map((item) => renderDisplayBlock(item.block, item.index, context))}</div> : null}
      {rest.length ? <div className={styles.canvasSummary}>{rest.map((item) => renderDisplayBlock(item.block, item.index, context))}</div> : null}
    </div>
  );
}

export function TextOpsPage() {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<TextOpsRun[]>([]);
  const [activeRunID, setActiveRunID] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [activeQuick, setActiveQuick] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  const [role, setRole] = useLocalStorage<TextOpsRole>('textOps.role', 'admin');

  // AI Copilot panel width (resizable splitter). Persisted to localStorage so the user's
  // preferred width survives navigations.
  const [chatWidth, setChatWidth] = useLocalStorage<number>('textOps.chatWidth', 420);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const isDraggingSplitterRef = useRef(false);

  const handleSplitterDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    isDraggingSplitterRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleSplitterDoubleClick = useCallback(() => {
    // 双击 = 还原默认宽度（fit-content baseline）
    setChatWidth(420);
  }, [setChatWidth]);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!isDraggingSplitterRef.current || !workspaceRef.current) return;
      const rect = workspaceRef.current.getBoundingClientRect();
      const next = event.clientX - rect.left;
      const min = 340;
      const max = Math.max(min + 120, rect.width - 480);
      setChatWidth(Math.min(Math.max(next, min), max));
    };
    const handleUp = () => {
      if (!isDraggingSplitterRef.current) return;
      isDraggingSplitterRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [setChatWidth]);
  const [operatorUserID, setOperatorUserID] = useLocalStorage<string>('textOps.operatorUserID', '1');
  const [allowedUserIDsRaw, setAllowedUserIDsRaw] = useLocalStorage<string>('textOps.allowedUserIDs', '1001,1002');

  const [llmEnabled, setLlmEnabled] = useLocalStorage<boolean>('textOps.llmEnabled', true);
  const [llmAPIKey, setLlmAPIKey] = useState<string>(() => {
    const stored = secureStorage.getItem<string>('textOps.llmAPIKey', { obfuscate: true });
    return stored ?? '';
  });
  const persistLlmAPIKey = useCallback((value: string) => {
    setLlmAPIKey(value);
    if (value) {
      secureStorage.setItem('textOps.llmAPIKey', value, { obfuscate: true });
    } else {
      secureStorage.removeItem('textOps.llmAPIKey');
    }
  }, []);
  const [llmBaseURL, setLlmBaseURL] = useLocalStorage<string>('textOps.llmBaseURL', 'http://localhost:8317/v1');
  const [llmModel, setLlmModel] = useLocalStorage<string>('textOps.llmModel', 'MiniMax-M3');

  const resetConfig = useCallback(() => {
    if (typeof window === 'undefined') return;
    setRole('admin');
    setOperatorUserID('1');
    setAllowedUserIDsRaw('1001,1002');
    setLlmEnabled(true);
    setLlmBaseURL('http://localhost:8317/v1');
    setLlmModel('MiniMax-M3');
    secureStorage.removeItem('textOps.llmAPIKey');
    setLlmAPIKey('');
  }, [setRole, setOperatorUserID, setAllowedUserIDsRaw, setLlmEnabled, setLlmBaseURL, setLlmModel]);

  const canSubmit = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);
  const activeRun = useMemo(() => runs.find((run) => run.id === activeRunID) || runs[runs.length - 1], [activeRunID, runs]);
  const followUpQueries = useMemo(() => buildFollowUpQueries(activeRun?.response), [activeRun?.response]);
  const configSummary = `${llmEnabled ? 'AI ON' : 'AI OFF'} | ${QUICK_CAPABILITIES.length} quick prompts | ${llmModel || '-'}`;

  // Tracks the in-flight request so the Stop button can cancel it.
  const abortControllerRef = useRef<AbortController | null>(null);
  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);
  // Tracks IME composition so Enter during Chinese input confirmation isn't treated as send.
  const isComposingRef = useRef(false);

  // Slash command palette: shows a filtered list when the input starts with `/`.
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashFilter = input.startsWith('/') ? input.slice(1).toLowerCase() : '';
  const slashFiltered = useMemo(() => {
    if (!slashOpen) return [];
    const filter = slashFilter.trim();
    if (!filter) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(filter) ||
        cmd.id.toLowerCase().includes(filter) ||
        cmd.hint.toLowerCase().includes(filter),
    );
  }, [slashOpen, slashFilter]);
  // Keep slashIndex inside the filtered list when it shrinks.
  useEffect(() => {
    if (slashIndex >= slashFiltered.length) {
      setSlashIndex(Math.max(0, slashFiltered.length - 1));
    }
  }, [slashFiltered.length, slashIndex]);
  const closeSlashMenu = useCallback(() => {
    setSlashOpen(false);
    setSlashIndex(0);
  }, []);
  const applySlashCommand = useCallback((cmd: SlashCommand) => {
    setInput(cmd.query);
    setActiveQuick(null);
    closeSlashMenu();
  }, [closeSlashMenu]);

  const executeQuery = useCallback(
    async (rawQuery: string, quickValue?: string) => {
      const userQuery = rawQuery.trim();
      if (!userQuery || loading) return;

      const runID = `run-${Date.now()}`;
      const baseRun: TextOpsRun = {
        id: runID,
        query: userQuery,
        createdAt: Date.now(),
        aiEnabled: llmEnabled,
        aiModel: llmModel,
      };
      setRuns((prev) => [...prev, baseRun]);
      setActiveRunID(runID);
      setActiveQuick(quickValue || (QUICK_CAPABILITIES.includes(userQuery) ? userQuery : null));
      setInput('');
      setLoading(true);

      // Build a fresh AbortController for this run so the user can cancel mid-flight.
      const controller = new AbortController();
      abortControllerRef.current = controller;
      let aborted = false;

      try {
        const operatorID = Number.parseInt(operatorUserID, 10);
        const response = await textOpsApi.query(
          {
            user_query: userQuery,
            current_time: new Date().toISOString(),
            operator_context: {
              role,
              user_id: Number.isFinite(operatorID) && operatorID > 0 ? operatorID : 1,
              allowed_user_ids: role === 'reseller' ? parseAllowedUserIDs(allowedUserIDsRaw) : [],
            },
            router: {
              enabled: llmEnabled,
              api_key: llmAPIKey,
              base_url: llmBaseURL,
              model: llmModel,
              max_tokens: 2000,
            },
            presenter: {
              enabled: llmEnabled,
              api_key: llmAPIKey,
              base_url: llmBaseURL,
              model: llmModel,
              max_tokens: 4096,
            },
          },
          { signal: controller.signal },
        );

        setRuns((prev) => prev.map((run) => (run.id === runID ? { ...run, response } : run)));
      } catch (error: unknown) {
        // User-initiated abort: surface as a soft "stopped" hint, not an error toast.
        if (controller.signal.aborted) {
          aborted = true;
          setRuns((prev) => prev.map((run) => (run.id === runID ? {
            ...run,
            error: t('text_ops.stopped', { defaultValue: '已停止当前执行。' }),
          } : run)));
        } else {
          const fallbackResponse = normalizeQueryResponseFromError(error);
          setRuns((prev) => prev.map((run) => (run.id === runID ? {
            ...run,
            response: fallbackResponse || undefined,
            error: buildAssistantErrorMessage(error),
          } : run)));
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        setLoading(false);
        if (aborted) {
          // No-op: abort flag is read by setRuns above.
        }
      }
    },
    [
      loading,
      operatorUserID,
      role,
      allowedUserIDsRaw,
      llmEnabled,
      llmAPIKey,
      llmBaseURL,
      llmModel,
    ],
  );

  const handleQuickCapability = useCallback(
    (value: string) => {
      setInput(value);
      void executeQuery(value, value);
    },
    [executeQuery],
  );

  const updateMessageSelectedModel = useCallback((messageID: string, model: string | undefined) => {
    setRuns((prev) => prev.map((run) => (run.id === messageID ? { ...run, selectedModel: model } : run)));
  }, []);

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    void executeQuery(input);
  }, [canSubmit, executeQuery, input]);

  const renderResponseZeroState = () => (
    <div className={styles.responseZeroState}>
      <div className={styles.zeroStateCenter}>
        <div className={styles.zeroHero}>
          <div className={styles.zeroBeacon} aria-hidden="true">
            <IconBolt size={26} />
          </div>
          <div className={styles.zeroHeroText}>
            <h3>Autonomous Ops</h3>
            <p>自然语言运维引擎已成功接入全局拓扑网络。您可以直接使用人类语言对底层的模型流量、通道异常进行毫秒级调度与诊断。</p>
          </div>
        </div>

        <div className={styles.zeroDivider} />

        <div className={styles.zeroCapabilityPanel}>
          <div className={styles.zeroCapabilityLabel}>系统就绪指令 / Capability</div>
          <div className={styles.zeroCapabilityGrid}>
            {ZERO_STATE_CAPABILITIES.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`${styles.zeroCapabilityCard} ${styles[`zeroCapability_${item.key}`] || ''}`}
                onClick={() => handleQuickCapability(item.query)}
                disabled={loading}
              >
                <span className={styles.zeroCapabilityIcon} aria-hidden="true">{item.icon}</span>
                <span className={styles.zeroCapabilityContent}>
                  <strong>{item.title}</strong>
                  <small>{item.query}</small>
                  <em>{item.detail}</em>
                </span>
                <IconChevronsRight className={styles.zeroCapabilityArrow} size={16} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.zeroStatusBar}>
        <span className={styles.zeroStatusOnline}>
          <span className={styles.zeroStatusDot} aria-hidden="true" />
          ROUTER: ONLINE
        </span>
        <span>CLUSTER TIME: {new Date().toISOString().slice(0, 10)}</span>
      </div>
    </div>
  );

  const renderAssistantCanvas = () => {
    if (activeRun?.response?.presentation?.blocks?.length) {
      return renderCanvasBlocks(
        activeRun.response.presentation.blocks,
        {
          response: activeRun.response,
          selectedModel: activeRun.selectedModel,
          onSelectModel: (model) => updateMessageSelectedModel(activeRun.id, model),
        },
      );
    }
    if (loading) return <div className={styles.skeletonPanel} />;
    if (!activeRun) {
      return (
        <div className={styles.canvasStandby}>
          <div className={styles.canvasStandbyAurora} aria-hidden="true" />
          <div className={styles.canvasStandbyGrid} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className={styles.canvasStandbyContent}>
            <div className={styles.canvasStandbyIcon} aria-hidden="true">
              <IconDatabaseStack size={32} />
            </div>
            <div className={styles.canvasStandbyText}>
              <h2>Data Canvas Standby</h2>
              <p>
                当前动态画布处于待机沙箱状态。请在左侧工作台触发运维指令，
                AI 引擎将实时捕获多维指标并重构此画布。
              </p>
            </div>
            <button
              type="button"
              className={styles.canvasStandbyButton}
              onClick={() => handleQuickCapability(PLACEHOLDER_QUERY)}
              disabled={loading}
            >
              <IconBolt size={13} />
              <span>Load Last System Snapshot</span>
            </button>
            <div className={styles.canvasStandbyMetrics} aria-hidden="true">
              <span>Tokens</span>
              <span>Cost</span>
              <span>Latency</span>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className={styles.emptyCanvas}>
        <IconBot size={28} />
        <span>{t('text_ops.empty', { defaultValue: '当前响应未返回可视化画布。' })}</span>
      </div>
    );
  };

  return (
    <div className={styles.page}>
      <section className={styles.controlCard}>
        <button
          type="button"
          className={styles.configToggle}
          onClick={() => setConfigOpen((open) => !open)}
          aria-expanded={configOpen}
        >
          <div className={styles.configTitleGroup}>
            <span className={styles.configPulse} aria-hidden="true" />
            <IconBot size={16} />
            <span className={styles.configTitle}>AI COPILOT PANEL</span>
            {!configOpen ? <span className={styles.configSummary}>{configSummary}</span> : null}
          </div>
          <div className={styles.configToggleRight}>
            <span className={styles.configStatus}>{llmEnabled ? 'CPA AI ON' : 'LOCAL'}</span>
            <IconChevronDown className={`${styles.configChevron} ${configOpen ? styles.configChevronOpen : ''}`} size={16} />
          </div>
        </button>

        <div className={`${styles.configBody} ${configOpen ? styles.configBodyOpen : ''}`} aria-hidden={!configOpen}>
          <div className={styles.controlGrid}>
            <div className={styles.configItem}>
              <label>OPERATOR ACCOUNT</label>
              <div className={`${styles.configInputWrapper} ${styles.selectType}`}>
                <Select
                  className={styles.configSelect}
                  value={role}
                  options={roleOptions.map((item) => ({ value: item.value, label: item.label }))}
                  onChange={(value) => setRole(value as TextOpsRole)}
                  ariaLabel="role"
                />
              </div>
            </div>
            <div className={styles.configItem}>
              <label>GATEWAY ID</label>
              <div className={styles.configInputWrapper}>
                <input
                  value={operatorUserID}
                  onChange={(event) => setOperatorUserID(event.target.value)}
                  placeholder={t('text_ops.user_id', { defaultValue: 'Operator User ID' })}
                />
              </div>
            </div>
            <div className={styles.configItem}>
              <label>ROUTING CLUSTER</label>
              <div className={styles.configInputWrapper}>
                <input
                  value={allowedUserIDsRaw}
                  onChange={(event) => setAllowedUserIDsRaw(event.target.value)}
                  placeholder={t('text_ops.allowed_ids', { defaultValue: 'Allowed User IDs (comma separated)' })}
                  disabled={role !== 'reseller'}
                />
              </div>
            </div>
            <div className={`${styles.configItem} ${styles.configWide}`}>
              <label>CPA / OPENAI BASE URL</label>
              <div className={styles.configInputWrapper}>
                <input
                  value={llmBaseURL}
                  onChange={(event) => setLlmBaseURL(event.target.value)}
                  placeholder={t('text_ops.llm_base_url', { defaultValue: 'LLM Base URL (optional)' })}
                />
              </div>
            </div>
            <div className={styles.configItem}>
              <label>CORE MODEL ROUTE</label>
              <div className={`${styles.configInputWrapper} ${styles.modelTag}`}>
                <input
                  value={llmModel}
                  onChange={(event) => setLlmModel(event.target.value)}
                  placeholder={t('text_ops.llm_model', { defaultValue: 'LLM Model' })}
                />
              </div>
            </div>
            <div className={styles.configItem}>
              <label>PROXY API KEY</label>
              <div className={`${styles.configInputWrapper} ${styles.secureInput}`}>
                <input
                  type="password"
                  value={llmAPIKey}
                  onChange={(event) => persistLlmAPIKey(event.target.value)}
                  placeholder={t('text_ops.llm_api_key', { defaultValue: 'CPA/OpenAI API Key（留空则使用 CPA 配置）' })}
                />
              </div>
            </div>
          </div>

          <div className={styles.configFooter}>
            <label className={styles.cyberCheckbox}>
              <input
                type="checkbox"
                checked={llmEnabled}
                onChange={(event) => setLlmEnabled(event.target.checked)}
              />
              <span className={styles.checkmark} />
              <span className={styles.checkboxText}>{t('text_ops.enable_llm', { defaultValue: 'Enable CPA AI router + presenter' })}</span>
            </label>

            <button
              type="button"
              className={styles.resetButton}
              onClick={() => {
                if (window.confirm(t('text_ops.reset_config_confirm', { defaultValue: '重置所有 AI 配置（模型、Base URL、API Key 等）？' }))) {
                  resetConfig();
                }
              }}
              title={t('text_ops.reset_config_title', { defaultValue: '清空已记忆的配置并恢复默认值' })}
            >
              ⟲ Reset Config
            </button>

            <div className={styles.quickPanel}>
              <div className={styles.quickTitle}>Quick Prompts</div>
              <button
                type="button"
                className={styles.placeholderHint}
                onClick={() => {
                  setInput(PLACEHOLDER_QUERY);
                  setActiveQuick(null);
                }}
              >
                {PLACEHOLDER_QUERY}
              </button>
            </div>
          </div>
        </div>
      </section>

      <div
        ref={workspaceRef}
        className={styles.workspaceGrid}
        style={{ '--chat-pane-width': `${chatWidth}px` } as CSSProperties}
      >
        <section className={styles.chatPane}>
          <div className={styles.paneHeader}>
            <div className={styles.engineTitle}>
              <span className={styles.enginePulse} aria-hidden="true" />
              <span>AI COPILOT ENGINE</span>
            </div>
            <span className={styles.engineState}>{llmEnabled ? 'CPA AI ON' : 'LOCAL HEURISTIC'}</span>
          </div>

          <div className={styles.sandbox}>
            <div className={styles.historyRail}>
              <div className={styles.historyTitle}>History Log</div>
              {runs.length === 0 ? (
                <div className={styles.historyEmpty}>暂无历史记录</div>
              ) : null}
              {runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  className={`${styles.historyItem} ${activeRun?.id === run.id ? styles.historyItemActive : ''}`}
                  onClick={() => setActiveRunID(run.id)}
                >
                  <span>{formatRunTime(run.createdAt)}</span>
                  <strong>{getRunSummary(run.query)}</strong>
                </button>
              ))}
            </div>
            <div className={styles.responsePane}>
              {activeRun ? (
                <>
                  <div className={styles.responseQuery}>{activeRun.query}</div>
                  {activeRun.error ? <div className={styles.errorText}>{activeRun.error}</div> : null}
                  <div className={styles.responseSection}>
                    <div className={styles.responseSectionLabel}>AI Execution Trace</div>
                    <div className={styles.aiTraceStack}>
                      {getTextOpsRunAIPhases(activeRun).map((phase) => (
                        <div key={phase.key} className={`${styles.aiTrace} ${styles[`aiTrace_${phase.tone}`] || ''}`}>
                          <span className={styles.traceDot} aria-hidden="true" />
                          <div>
                            <span>{phase.label}</span>
                            <small>{phase.detail}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                    {activeRun.response ? (
                      <div className={styles.intentBadge}>
                        <span>{activeRun.response.router.intent}</span>
                        <small>{String(activeRun.response.router.filters?.start_time || '')} ~ {String(activeRun.response.router.filters?.end_time || '')}</small>
                      </div>
                    ) : null}
                    {activeRun.response?.warnings?.length ? (
                      <div className={styles.warningList}>
                        {activeRun.response.warnings.slice(0, 3).map((warning) => {
                          const { prefix, items } = parseWarningChip(warning);
                          return (
                            <div key={warning} className={styles.warningChip}>
                              <span className={styles.warningChipPrefix}>{prefix}</span>
                              {items.length > 0 ? (
                                <span className={styles.warningChipItems}>
                                  {items.map((item) => (
                                    <span key={item} className={styles.warningChipItem}>
                                      {item}
                                    </span>
                                  ))}
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                  {activeRun.response?.presentation?.markdown ? (
                    (() => {
                      const { pairs, rest } = splitInsightKeyValues(activeRun.response!.presentation!.markdown);
                      return (
                        <div className={styles.responseSection}>
                          <div className={styles.responseSectionLabel}>Insight Summary</div>
                          {pairs.length > 0 ? (
                            <div className={styles.insightKvGrid}>
                              {pairs.map((pair, pairIndex) => (
                                <div
                                  key={`${pair.label}-${pairIndex}`}
                                  className={styles.insightKvRow}
                                >
                                  <span className={styles.insightKvLabel}>{pair.label}</span>
                                  <span className={styles.insightKvValue}>{pair.value}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {rest ? (
                            <div className={styles.insightCard}>
                              <MarkdownBlock text={rest} />
                            </div>
                          ) : null}
                        </div>
                      );
                    })()
                  ) : loading && activeRun.id === activeRunID ? (
                    <div className={styles.loadingHint}>{t('text_ops.loading', { defaultValue: '正在解析并执行...' })}</div>
                  ) : null}
                  {followUpQueries.length ? (
                    <div className={styles.followUpRow}>
                      {followUpQueries.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className={styles.followUpChip}
                          onClick={() => handleQuickCapability(item)}
                          disabled={loading}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : renderResponseZeroState()}
            </div>
          </div>

          <div className={styles.composer}>
            <div className={styles.quickRow}>
              {QUICK_CAPABILITIES.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`${styles.quickChip} ${activeQuick === item ? styles.quickChipActive : ''}`}
                  onClick={() => handleQuickCapability(item)}
                  disabled={loading}
                >
                  ⚡ {item}
                </button>
              ))}
            </div>
            {slashOpen ? (
              <div className={styles.slashMenu} role="listbox" aria-label="快捷指令">
                <div className={styles.slashMenuHeader}>
                  <span>快捷指令</span>
                  <small>↑↓ 选择 · Enter 应用 · Esc 关闭</small>
                </div>
                {slashFiltered.length === 0 ? (
                  <div className={styles.slashMenuEmpty}>没有匹配的指令</div>
                ) : (
                  slashFiltered.map((cmd, index) => (
                    <button
                      key={cmd.id}
                      type="button"
                      role="option"
                      aria-selected={index === slashIndex}
                      className={`${styles.slashItem} ${index === slashIndex ? styles.slashItemActive : ''}`}
                      onMouseEnter={() => setSlashIndex(index)}
                      onClick={() => applySlashCommand(cmd)}
                    >
                      <span className={styles.slashItemLabel}>{cmd.label}</span>
                      <span className={styles.slashItemHint}>{cmd.hint}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
            <div className={styles.inputShell}>
              <textarea
                className={styles.textarea}
                placeholder={t('text_ops.placeholder', { defaultValue: `输入运维指令，Enter 直接运行...` })}
                value={input}
                onChange={(event) => {
                  const next = event.target.value;
                  setInput(next);
                  if (activeQuick && next !== activeQuick) {
                    setActiveQuick(null);
                  }
                  // Slash menu: only when the user starts the line with `/`. Any other
                  // leading text closes the menu.
                  if (next.startsWith('/')) {
                    if (!slashOpen) setSlashOpen(true);
                    setSlashIndex(0);
                  } else if (slashOpen) {
                    closeSlashMenu();
                  }
                }}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false;
                }}
                onKeyDown={(event) => {
                  // Bail out while IME is composing (Chinese/Japanese/Korean input methods
                  // fire Enter to confirm a candidate, not to send the message). `keyCode 229`
                  // is the legacy IME composition sentinel for browsers that don't set
                  // `isComposing` on the synthetic event.
                  if (event.nativeEvent.isComposing || event.keyCode === 229) {
                    return;
                  }
                  if (isComposingRef.current) {
                    return;
                  }

                  // Slash menu takes priority over Enter/Send when open.
                  if (slashOpen && slashFiltered.length > 0) {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setSlashIndex((idx) => (idx + 1) % slashFiltered.length);
                      return;
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      setSlashIndex((idx) => (idx - 1 + slashFiltered.length) % slashFiltered.length);
                      return;
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      const picked = slashFiltered[slashIndex];
                      if (picked) {
                        applySlashCommand(picked);
                        return;
                      }
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      closeSlashMenu();
                      return;
                    }
                  } else if (event.key === 'Escape' && slashOpen) {
                    event.preventDefault();
                    closeSlashMenu();
                    return;
                  }

                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleSubmit();
                  }
                }}
                rows={3}
              />
              <button
                type="button"
                className={`${styles.sendButton} ${loading ? styles.sendButtonStop : ''}`}
                onClick={loading ? handleStop : handleSubmit}
                disabled={!loading && !canSubmit}
                aria-label={loading
                  ? t('text_ops.stop', { defaultValue: '停止' })
                  : t('text_ops.send', { defaultValue: '执行' })}
                title={loading
                  ? t('text_ops.stop_hint', { defaultValue: '点击停止当前执行' })
                  : t('text_ops.send_hint', { defaultValue: 'Enter 发送 / Shift+Enter 换行' })}
              >
                {loading ? (
                  <svg className={styles.stopIcon} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <rect x="5" y="5" width="10" height="10" rx="1.5" />
                  </svg>
                ) : (
                  <IconChevronsRight size={18} />
                )}
              </button>
            </div>
          </div>
        </section>

        <div
          className={styles.workspaceSplitter}
          onMouseDown={handleSplitterDown}
          onDoubleClick={handleSplitterDoubleClick}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('text_ops.resize_panel', { defaultValue: '调整 AI Copilot 面板宽度（双击重置）' })}
          title={t('text_ops.resize_panel_hint', { defaultValue: '拖拽调整宽度 / 双击还原' })}
        >
          <span className={styles.workspaceSplitterGrip} aria-hidden="true" />
        </div>

        <section className={styles.canvasPane}>{renderAssistantCanvas()}</section>
      </div>
    </div>
  );
}
