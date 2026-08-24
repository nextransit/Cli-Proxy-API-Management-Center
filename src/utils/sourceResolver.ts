import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { CredentialInfo, SourceInfo } from '@/types/sourceInfo';
import { buildCandidateUsageSourceIds, normalizeAuthIndex, normalizeUsageSourceId } from '@/utils/usage';

export interface SourceInfoMapInput {
  geminiApiKeys?: GeminiKeyConfig[];
  claudeApiKeys?: ProviderKeyConfig[];
  codexApiKeys?: ProviderKeyConfig[];
  vertexApiKeys?: ProviderKeyConfig[];
  openaiCompatibility?: OpenAIProviderConfig[];
}

type SourceInfoEntry = Required<Pick<SourceInfo, 'displayName' | 'type' | 'identityKey'>>;

export interface SourceInfoMap {
  byAuthIndex: Map<string, SourceInfoEntry | null>;
  bySource: Map<string, SourceInfoEntry | null>;
}

const buildProviderIdentityKey = (type: string, index: number) => `${type}:${index}`;

const registerIdentity = (
  map: Map<string, SourceInfoEntry | null>,
  key: string | null | undefined,
  entry: SourceInfoEntry
) => {
  if (!key) return;

  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, entry);
    return;
  }

  if (existing === null) {
    return;
  }

  if (existing.identityKey === entry.identityKey) {
    return;
  }

  map.set(key, null);
};

// Strict well-known provider key prefixes. The broader `minimax-`,
// `qwen-`, `glm-`, etc. tokens are intentionally NOT included: those
// are user-chosen identifier prefixes that double as credentials in this
// deployment, so they should resolve to the configured displayName
// instead of being redacted.
export const PROVIDER_KEY_PREFIX = /^(sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{6,}|sk-or-[A-Za-z0-9_-]{6,}|AIza[0-9A-Za-z_-]+|ghp_[A-Za-z0-9]{6,}|gho_[A-Za-z0-9]{6,}|github_pat_[A-Za-z0-9_]{6,}|xai-[A-Za-z0-9]{6,}|pplx-[A-Za-z0-9]{6,})/;

export const looksLikeProviderKey = (value: string) => PROVIDER_KEY_PREFIX.test(value);

const formatRawSourceDisplayName = (source: string) => {
  if (!source) return '-';
  // (legacy): handled below in the bySource-miss branch with redacted hash
  return source.startsWith('t:') ? source.slice(2) : source;
};

export function buildSourceInfoMap(input: SourceInfoMapInput): SourceInfoMap {
  const byAuthIndex = new Map<string, SourceInfoEntry | null>();
  const bySource = new Map<string, SourceInfoEntry | null>();

  const registerProvider = (
    entry: SourceInfoEntry,
    authIndices: Array<unknown>,
    candidates: Iterable<string>
  ) => {
    authIndices.forEach((authIndex) => {
      registerIdentity(byAuthIndex, normalizeAuthIndex(authIndex), entry);
    });

    Array.from(candidates).forEach((candidate) => {
      registerIdentity(bySource, candidate, entry);
    });
  };

  const providers: Array<{
    items: Array<{ apiKey?: string; prefix?: string; authIndex?: string; baseUrl?: string }>;
    type: string;
    label: string;
  }> = [
    { items: input.geminiApiKeys || [], type: 'gemini', label: 'Gemini' },
    { items: input.claudeApiKeys || [], type: 'claude', label: 'Claude' },
    { items: input.codexApiKeys || [], type: 'codex', label: 'Codex' },
    { items: input.vertexApiKeys || [], type: 'vertex', label: 'Vertex' },
  ];

  providers.forEach(({ items, type, label }) => {
    items.forEach((item, index) => {
      const defaultDisplayName = `${label} #${index + 1}`;
      registerProvider(
        {
          displayName: item.prefix?.trim() || defaultDisplayName,
          type,
          identityKey: buildProviderIdentityKey(type, index),
        },
        [item.authIndex, defaultDisplayName],
        buildCandidateUsageSourceIds({ apiKey: item.apiKey, prefix: item.prefix })
      );
      // Also register the configured baseUrl so backend usage events
      // whose Source equals the upstream URL can match (e.g. a Codex
      // provider backed by an internal proxy URL).
      const baseUrl = (item.baseUrl ?? '').trim();
      if (baseUrl) {
        registerIdentity(bySource, `${'t:'}${baseUrl}`, {
          displayName: item.prefix?.trim() || `${label} #${index + 1}`,
          type,
          identityKey: buildProviderIdentityKey(type, index),
        });
      }
    });
  });

  (input.openaiCompatibility || []).forEach((provider, providerIndex) => {
    const providerName = provider.name?.trim() || `OpenAI #${providerIndex + 1}`;
    const displayName = provider.prefix?.trim() || providerName;
    const backendDisplayName = `${providerName.toLowerCase()} #${providerIndex + 1}`;
    registerProvider(
      {
        displayName,
        type: 'openai',
        identityKey: buildProviderIdentityKey('openai', providerIndex),
      },
      [provider.authIndex, backendDisplayName],
      buildCandidateUsageSourceIds({ prefix: provider.prefix })
    );

    const apiKeyEntries = provider.apiKeyEntries || [];
    apiKeyEntries.forEach((entry, keyIndex) => {
      const keyDisplayName =
        apiKeyEntries.length > 1 ? `${displayName}-${keyIndex + 1}` : displayName;
      registerProvider(
        {
          displayName: keyDisplayName,
          type: 'openai',
          identityKey: `${buildProviderIdentityKey('openai', providerIndex)}:key:${keyIndex}`,
        },
        [entry.authIndex, `${backendDisplayName}.${keyIndex + 1}`],
        buildCandidateUsageSourceIds({ apiKey: entry.apiKey })
      );
    });
  });

  return { byAuthIndex, bySource };
}

export function resolveSourceDisplay(
  sourceRaw: string,
  authIndex: unknown,
  sourceInfoMap: SourceInfoMap,
  authFileMap: Map<string, CredentialInfo>
): SourceInfo {
  const source = sourceRaw.trim();
  const authIndexKey = normalizeAuthIndex(authIndex);

  if (authIndexKey) {
    const matchedByAuthIndex = sourceInfoMap.byAuthIndex.get(authIndexKey);
    if (matchedByAuthIndex) {
      return matchedByAuthIndex;
    }

    const authInfo = authFileMap.get(authIndexKey);
    if (authInfo) {
      return {
        displayName: authInfo.name || authIndexKey,
        type: authInfo.type,
        identityKey: `auth:${authIndexKey}`,
      };
    }
  }

  const matchedBySource = source ? sourceInfoMap.bySource.get(source) : null;
  if (matchedBySource) {
    return matchedBySource;
  }

  // Try a few registration flavours so backend usage events whose Source
  // equals a raw api_key, a base URL, or a literal text tag still resolve
  // to the configured credential (Claude #76, Codex #26, OpenAI
  // minimax-1, ...). The registered candidates cover the literal apiKey,
  // the FNV-hashed form, the masked form, and the t:<url>/t:<text> form.
  if (source) {
    const candidates = [
      source.startsWith('t:') || source.startsWith('k:') || source.startsWith('m:')
        ? source
        : `t:${source}`,
    ];
    candidates.push(normalizeUsageSourceId(source));
    for (const candidate of candidates) {
      const matched = sourceInfoMap.bySource.get(candidate);
      if (matched) {
        return matched;
      }
    }
  }

  if (source) {
    if (looksLikeProviderKey(source)) {
      const identitySuffix =
        authIndexKey || normalizeUsageSourceId(source).replace(/^[a-z]:/, '').slice(0, 8);
      return {
        displayName: identitySuffix ? `API Key #${identitySuffix}` : 'API Key',
        type: '',
        identityKey: `source:redacted:${identitySuffix}`,
      };
    }
    return {
      displayName: formatRawSourceDisplayName(source),
      type: '',
      identityKey: `source:${source}`,
    };
  }

  if (authIndexKey) {
    return {
      displayName: authIndexKey,
      type: '',
      identityKey: `auth:${authIndexKey}`,
    };
  }

  return {
    displayName: '-',
    type: '',
    identityKey: 'source:-',
  };
}
