import type { RuntimeName } from '@dar-tech/types';

export const DEFAULT_PORTS: Readonly<Record<RuntimeName, number | null>> = {
  api: 3001,
  web: 3000,
  worker: null,
};
