import { describe, expect, it } from 'vitest';
import { RoleModule } from './role.module.js';

describe('S02-T05 role security composition', () => {
  it.each(['development', 'staging', 'production'] as const)(
    'refuses test actor or authorization adapters in %s',
    (environment) => {
      expect(() =>
        RoleModule.register(environment, {
          actors: { currentActor: () => Promise.resolve(null) },
        }),
      ).toThrow('Role test adapters are available only in the test environment');
    },
  );

  it('allows explicit adapters only in APP_ENV=test', () => {
    expect(() =>
      RoleModule.register('test', {
        actors: { currentActor: () => Promise.resolve(null) },
        authorization: { authorize: () => Promise.resolve(false) },
      }),
    ).not.toThrow();
  });
});
