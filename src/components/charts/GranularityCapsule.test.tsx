import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { GranularityCapsule } from './GranularityCapsule';

beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: {
        translation: {
          'usage_stats.granularity_hour_short': 'HR',
          'usage_stats.granularity_day_short': 'DAY',
          'usage_stats.granularity_day_disabled_today': 'Today has only one day — switch to HR',
        },
      },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  i18n.changeLanguage('en');
});

describe('<GranularityCapsule />', () => {
  it('renders both HR and DAY buttons', () => {
    render(
      <GranularityCapsule cardId="usage_trend" value="hour" onChange={() => {}} timeRange="7d" />,
    );
    expect(screen.getByRole('button', { name: 'HR' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DAY' })).toBeInTheDocument();
  });

  it('disables DAY when timeRange is "today"', () => {
    render(
      <GranularityCapsule cardId="usage_trend" value="hour" onChange={() => {}} timeRange="today" />,
    );
    expect(screen.getByRole('button', { name: 'HR' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'DAY' })).toBeDisabled();
  });

  it('enables DAY for other time ranges', () => {
    render(
      <GranularityCapsule cardId="usage_trend" value="hour" onChange={() => {}} timeRange="7d" />,
    );
    expect(screen.getByRole('button', { name: 'DAY' })).not.toBeDisabled();
  });

  it('marks the current value as aria-pressed=true', () => {
    render(
      <GranularityCapsule cardId="usage_trend" value="day" onChange={() => {}} timeRange="7d" />,
    );
    expect(screen.getByRole('button', { name: 'HR' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'DAY' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('invokes onChange with "hour" when HR is clicked', async () => {
    const onChange = vi.fn();
    render(
      <GranularityCapsule cardId="usage_trend" value="day" onChange={onChange} timeRange="7d" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'HR' }));
    expect(onChange).toHaveBeenCalledWith('hour');
  });

  it('invokes onChange with "day" when DAY is clicked', async () => {
    const onChange = vi.fn();
    render(
      <GranularityCapsule cardId="usage_trend" value="hour" onChange={onChange} timeRange="7d" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'DAY' }));
    expect(onChange).toHaveBeenCalledWith('day');
  });

  it('does not call onChange when the disabled DAY button is clicked', async () => {
    const onChange = vi.fn();
    render(
      <GranularityCapsule cardId="usage_trend" value="hour" onChange={onChange} timeRange="today" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'DAY' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('honors the disabled prop for both buttons', () => {
    render(
      <GranularityCapsule cardId="usage_trend" value="hour" onChange={() => {}} timeRange="7d" disabled />,
    );
    expect(screen.getByRole('button', { name: 'HR' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'DAY' })).toBeDisabled();
  });
});
