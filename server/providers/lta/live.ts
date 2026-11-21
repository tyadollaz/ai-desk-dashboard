// PLACEHOLDER: replaced by the real lta live adapter later. Keep the factory signature.
import type { AdapterFactory } from '../types.js';
import { ProviderError } from '../types.js';

const REQUIREMENT = 'lta live adapter not implemented yet';

export const createLiveAdapter: AdapterFactory<'lta'> = () => ({
  id: 'lta',
  mode: 'live',
  async setupStatus() {
    return { connection: 'needs_setup', requirement: REQUIREMENT };
  },
  async fetch() {
    throw new ProviderError('needs_setup', REQUIREMENT);
  },
});
