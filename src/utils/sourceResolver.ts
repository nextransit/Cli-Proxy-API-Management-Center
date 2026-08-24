import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { CredentialInfo, SourceInfo } from '@/types/sourceInfo';
import { buildCandidateUsageSourceIds, normalizeAuthIndex } from '@/utils/usage';

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

export const PROVIDER_KEY_PREFIX = /^(sk-[A-Za-z0-9_-]{8,}|sk-ant-|sk-or-|AIza[0-9A-Za-z_-]{8,}|ghp_|gho_|github_pat_|dapi|ntn_|xai-|groq-|cog-|jfk-|pplx-|fvMk|qwen-|glm-|minimax-|MiniMax-)/;

export const looksLikeProviderKey = (value: string) => PROVIDER_KEY_PREFIX.test(value);

const formatRawSourceDisplayName = (source: string) => {
  if (!source) return '-';
  if (looksLikeProviderKey(source)) return '未命名来源';
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
    items: Array<{ apiKey?: string; prefix?: string; authIndex?: string }>;
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
      registerProvider(
        {
          displayName: item.prefix?.trim() || `${label} #${index + 1}`,
          type,
          identityKey: buildProviderIdentityKey(type, index),
        },
        [item.authIndex],
        buildCandidateUsageSourceIds({ apiKey: item.apiKey, prefix: item.prefix })
      );
    });
  });

  (input.openaiCompatibility || []).forEach((provider, providerIndex) => {
    const candidates = new Set<string>();
    const authIndices: Array<unknown> = [provider.authIndex];

    buildCandidateUsageSourceIds({ prefix: provider.prefix }).forEach((id) => candidates.add(id));
    (provider.apiKeyEntries || []).forEach((entry) => {
      authIndices.push(entry.authIndex);
      buildCandidateUsageSourceIds({ apiKey: entry.apiKey }).forEach((id) => candidates.add(id));
    });

    registerProvider(
      {
        displayName: provider.prefix?.trim() || provider.name || `OpenAI #${providerIndex + 1}`,
        type: 'openai',
        identityKey: buildProviderIdentityKey('openai', providerIndex),
      },
      authIndices,
      candidates
    );
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

  if (source) {
    if (looksLikeProviderKey(source)) {
      return {
        displayName: '未命名来源',
        type: '',
        identityKey: 'source:redacted',
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
