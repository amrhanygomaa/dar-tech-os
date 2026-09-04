import {
  Inject,
  Injectable,
  SetMetadata,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import {
  AUTHORIZATION_RESOLVER_METRICS_PORT,
  AUTHORIZATION_RESOURCE_TYPES,
  AUTHORIZATION_SCOPE_RESOLVERS,
  EXTENSION_SCOPE_TYPES,
  type AuthorizationResolverMetricsPort,
  type AuthorizationResourceType,
  type AuthorizationScopeRegistryOutcome,
  type AuthorizationScopeResolver,
  type AuthorizationScopeResolverCapability,
  type AuthorizationScopeResolverInput,
  type AuthorizationScopeResolverRegistryPort,
  type ExtensionScopeType,
} from './authorization.contracts.js';

const AUTHORIZATION_SCOPE_CAPABILITIES = Symbol('AUTHORIZATION_SCOPE_CAPABILITIES');

/**
 * Declares the exact bounded relationships owned by a production resolver.
 * The resolver remains an ordinary Nest provider and may inject its owning
 * module repositories/services normally.
 */
export function AuthorizationScopeResolverFor(
  ...capabilities: readonly AuthorizationScopeResolverCapability[]
): ClassDecorator {
  return SetMetadata(AUTHORIZATION_SCOPE_CAPABILITIES, capabilities);
}

function capabilityKey(
  scopeType: ExtensionScopeType,
  resourceType: AuthorizationResourceType,
): string {
  return `${scopeType}:${resourceType}`;
}

function validCapability(value: unknown): value is AuthorizationScopeResolverCapability {
  if (!value || typeof value !== 'object') return false;
  const capability = value as Partial<AuthorizationScopeResolverCapability>;
  return (
    EXTENSION_SCOPE_TYPES.includes(capability.scopeType as ExtensionScopeType) &&
    AUTHORIZATION_RESOURCE_TYPES.includes(capability.resourceType as AuthorizationResourceType)
  );
}

@Injectable()
export class AuthorizationScopeResolverRegistry
  implements AuthorizationScopeResolverRegistryPort, OnApplicationBootstrap
{
  private readonly resolvers = new Map<string, AuthorizationScopeResolver>();
  private sealed = false;

  constructor(
    @Inject(DiscoveryService)
    private readonly discovery: DiscoveryService,
    @Inject(AUTHORIZATION_SCOPE_RESOLVERS)
    private readonly compatibilityResolvers: readonly AuthorizationScopeResolver[],
    @Inject(AUTHORIZATION_RESOLVER_METRICS_PORT)
    private readonly metrics: AuthorizationResolverMetricsPort,
  ) {}

  onApplicationBootstrap(): void {
    if (this.sealed) return;

    for (const wrapper of this.discovery.getProviders()) {
      const resolver = wrapper.instance as AuthorizationScopeResolver | null | undefined;
      const capabilities = wrapper.metatype
        ? (Reflect.getMetadata(
            AUTHORIZATION_SCOPE_CAPABILITIES,
            wrapper.metatype,
          ) as readonly unknown[] | undefined)
        : undefined;
      if (capabilities === undefined) continue;
      if (!resolver || typeof resolver.resolve !== 'function' || typeof resolver.canResolve !== 'function') {
        throw new Error('Invalid authorization scope resolver provider');
      }
      this.register(resolver, capabilities);
    }

    // Retained only for T07-compatible test adapters. Production modules use
    // the class decorator plus ordinary Nest provider registration above.
    for (const resolver of this.compatibilityResolvers) {
      const capabilities: AuthorizationScopeResolverCapability[] = [];
      for (const scopeType of EXTENSION_SCOPE_TYPES) {
        for (const resourceType of AUTHORIZATION_RESOURCE_TYPES) {
          let ownsCapability: boolean;
          try {
            ownsCapability = resolver.canResolve(scopeType, resourceType) === true;
          } catch {
            throw new Error('Invalid authorization scope resolver capability declaration');
          }
          if (ownsCapability) capabilities.push({ scopeType, resourceType });
        }
      }
      this.register(resolver, capabilities);
    }

    this.sealed = true;
  }

  async resolve(input: AuthorizationScopeResolverInput): Promise<AuthorizationScopeRegistryOutcome> {
    const startedAt = performance.now();
    let outcome: AuthorizationScopeRegistryOutcome = 'UNAVAILABLE';
    try {
      const resolver = this.resolvers.get(
        capabilityKey(input.grant.scopeType, input.resource.type),
      );
      if (!resolver) return outcome;
      const resolution = await resolver.resolve(input);
      outcome = resolution === 'MATCH' || resolution === 'NO_MATCH' ? resolution : 'ERROR';
      return outcome;
    } catch {
      outcome = 'ERROR';
      return outcome;
    } finally {
      try {
        this.metrics.recordResolver({
          scopeType: input.grant.scopeType,
          resourceType: input.resource.type,
          outcome,
          latencyBucket: this.latencyBucket(performance.now() - startedAt),
        });
      } catch {
        // Resolver observability is best-effort and cannot change authorization.
      }
    }
  }

  private register(resolver: AuthorizationScopeResolver, capabilities: readonly unknown[]): void {
    if (capabilities.length === 0 || capabilities.some((capability) => !validCapability(capability))) {
      throw new Error('Invalid authorization scope resolver capability declaration');
    }
    for (const capability of capabilities as readonly AuthorizationScopeResolverCapability[]) {
      let ownsCapability: boolean;
      try {
        ownsCapability = resolver.canResolve(capability.scopeType, capability.resourceType) === true;
      } catch {
        throw new Error('Authorization scope resolver capability contract mismatch');
      }
      if (!ownsCapability) {
        throw new Error('Authorization scope resolver capability contract mismatch');
      }
      const key = capabilityKey(capability.scopeType, capability.resourceType);
      if (this.resolvers.has(key)) {
        throw new Error(
          `Ambiguous authorization scope resolver capability: ${capability.scopeType}/${capability.resourceType}`,
        );
      }
      this.resolvers.set(key, resolver);
    }
  }

  private latencyBucket(milliseconds: number) {
    if (milliseconds < 5) return 'LT_5_MS' as const;
    if (milliseconds < 25) return 'LT_25_MS' as const;
    if (milliseconds < 100) return 'LT_100_MS' as const;
    if (milliseconds < 500) return 'LT_500_MS' as const;
    return 'GTE_500_MS' as const;
  }
}
