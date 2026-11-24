import type { ApiResponse } from './models';

/** A separate advisory credential, never an LLM provider registration. */
export const JEV_CREDENTIAL_CHANNELS = {
  status: 'jev-credential:status',
  set: 'jev-credential:set',
  clear: 'jev-credential:clear'
} as const;

/** Bounds renderer input before it reaches encrypted storage. */
export const JEV_API_KEY_MAX_LENGTH = 4096;

export interface JevCredentialStatus {
  readonly configured: boolean;
}

export interface JevCredentialApi {
  getJevCredentialStatus(): Promise<ApiResponse<JevCredentialStatus>>;
  setJevCredential(apiKey: string): Promise<ApiResponse<JevCredentialStatus>>;
  clearJevCredential(): Promise<ApiResponse<JevCredentialStatus>>;
}
