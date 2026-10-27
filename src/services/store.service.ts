import { ApiError } from '../middleware/errors.js';

function unavailable(): never {
  throw new ApiError(503, 'MAX_STORE_NOT_IMPLEMENTED', 'MAX Store integration is not available yet');
}

export const storeService = {
  async search(_query: Record<string, string | number | undefined>) { return unavailable(); },
  async product(_slug: string) { return unavailable(); }
};
