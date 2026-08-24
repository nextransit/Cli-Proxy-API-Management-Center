import { describe, expect, it } from 'vitest';
import { buildSourceInfoMap, resolveSourceDisplay } from './sourceResolver';

const sharedKey =
  'sk-cp-shared-key-with-enough-characters-to-match-the-provider-key-redaction-rule';

describe('sourceResolver', () => {
  it('uses auth index to disambiguate a key shared by Claude and OpenAI compatibility', () => {
    const sourceInfoMap = buildSourceInfoMap({
      claudeApiKeys: [
        {
          apiKey: sharedKey,
          authIndex: 'claude-auth',
        },
      ],
      openaiCompatibility: [
        {
          name: 'minimax',
          baseUrl: 'https://api.minimaxi.com/v1',
          apiKeyEntries: [
            { apiKey: sharedKey, authIndex: 'openai-auth-1' },
            { apiKey: 'sk-cp-second-shared-key-with-enough-characters', authIndex: 'openai-auth-2' },
          ],
        },
      ],
    });

    expect(resolveSourceDisplay(sharedKey, 'claude-auth', sourceInfoMap, new Map()).displayName).toBe(
      'Claude #1'
    );
    expect(
      resolveSourceDisplay(sharedKey, 'openai-auth-1', sourceInfoMap, new Map()).displayName
    ).toBe('minimax-1');
  });

  it('maps backend-formatted auth labels back to configured display names', () => {
    const sourceInfoMap = buildSourceInfoMap({
      claudeApiKeys: [{ apiKey: sharedKey, authIndex: 'claude-auth' }],
      openaiCompatibility: [
        {
          name: 'minimax',
          baseUrl: 'https://api.minimaxi.com/v1',
          apiKeyEntries: [
            { apiKey: sharedKey, authIndex: 'openai-auth-1' },
            { apiKey: 'sk-cp-second-shared-key-with-enough-characters', authIndex: 'openai-auth-2' },
          ],
        },
      ],
    });

    expect(resolveSourceDisplay(sharedKey, 'Claude #1', sourceInfoMap, new Map()).displayName).toBe(
      'Claude #1'
    );
    expect(
      resolveSourceDisplay(sharedKey, 'minimax #1.1', sourceInfoMap, new Map()).displayName
    ).toBe('minimax-1');
  });

  it('uses a redacted auth-index fallback without exposing the raw provider key', () => {
    const sourceInfoMap = buildSourceInfoMap({});
    const resolved = resolveSourceDisplay(sharedKey, 'deadbeef12345678', sourceInfoMap, new Map());

    expect(resolved.displayName).toBe('API Key #deadbeef12345678');
    expect(resolved.displayName).not.toContain(sharedKey);
  });
});
