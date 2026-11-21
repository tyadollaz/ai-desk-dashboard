// PLACEHOLDER: replaced by the real weather live adapter later. Keep the factory signature.
import type { AdapterFactory } from '../types.js';
import { ProviderError } from '../types.js';

const REQUIREMENT = 'weather live adapter not implemented yet';

export const createLiveAdapter: AdapterFactory<'weather'> = () => ({
  id: 'weather',
  mode: 'live',
  async setupStatus() {
    return { connection: 'needs_setup', requirement: REQUIREMENT };
  },
  async fetch() {
    throw new ProviderError('needs_setup', REQUIREMENT);
  },
});
