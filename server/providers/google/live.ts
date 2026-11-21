// PLACEHOLDER: replaced by the real google live adapter later. Keep the factory signature.
import type { AdapterFactory } from '../types.js';
import { ProviderError } from '../types.js';

const REQUIREMENT = 'google live adapter not implemented yet';

export const createLiveAdapter: AdapterFactory<'google'> = () => ({
  id: 'google',
  mode: 'live',
  async setupStatus() {
    return { connection: 'needs_setup', requirement: REQUIREMENT };
  },
  async fetch() {
    throw new ProviderError('needs_setup', REQUIREMENT);
  },
});
