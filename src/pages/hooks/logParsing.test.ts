import { describe, expect, it } from 'vitest';
import { parseLogLine } from './logParsing';

describe('parseLogLine', () => {
  it('parses request failure summaries with downloadable error logs', () => {
    const parsed = parseLogLine(
      '[2026-06-18 12:00:00] [abcd1234] [error] request_failed | POST /v1/messages 400 | request_log=error-v1-messages-2026-abcd1234.log'
    );

    expect(parsed.timestamp).toBe('2026-06-18 12:00:00');
    expect(parsed.requestId).toBe('abcd1234');
    expect(parsed.level).toBe('error');
    expect(parsed.method).toBe('POST');
    expect(parsed.path).toBe('/v1/messages');
    expect(parsed.statusCode).toBe(400);
    expect(parsed.requestLogFile).toBe('error-v1-messages-2026-abcd1234.log');
    expect(parsed.message).toBe('request_failed');
  });

  it('does not treat request_log_id as a downloadable filename', () => {
    const parsed = parseLogLine(
      '[2026-06-18 12:00:00] [abcd1234] [error] request_failed | POST /v1/messages 500 | request_log_id=abcd1234'
    );

    expect(parsed.statusCode).toBe(500);
    expect(parsed.requestId).toBe('abcd1234');
    expect(parsed.requestLogFile).toBeUndefined();
  });

  it('parses response incomplete summaries with request log ids', () => {
    const parsed = parseLogLine(
      '[2026-06-20 11:26:02] [--------] [error] response_incomplete | POST /v1/responses 200 | reason=max_output_tokens | request_log_id=deadbeef'
    );

    expect(parsed.timestamp).toBe('2026-06-20 11:26:02');
    expect(parsed.requestId).toBe('deadbeef');
    expect(parsed.level).toBe('error');
    expect(parsed.method).toBe('POST');
    expect(parsed.path).toBe('/v1/responses');
    expect(parsed.statusCode).toBe(200);
    expect(parsed.message).toBe('response_incomplete | reason=max_output_tokens');
  });
});
