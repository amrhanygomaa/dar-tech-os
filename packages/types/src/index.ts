export type RuntimeName = 'api' | 'web' | 'worker';

export interface FoundationDescriptor {
  readonly name: 'dar-tech-os';
  readonly runtime: RuntimeName;
  readonly apiVersion: 'v1';
}
