export const OFFBOARDING_EVENTS = {
  employeeSuspended: { name: 'EmployeeSuspended.v1', eventType: 'identity.employee-suspended', eventVersion: 1 },
  offboardingStarted: { name: 'EmployeeOffboardingStarted.v1', eventType: 'identity.employee-offboarding-started', eventVersion: 1 },
  accessRevoked: { name: 'EmployeeAccessRevoked.v1', eventType: 'identity.employee-access-revoked', eventVersion: 1 },
  employeeOffboarded: { name: 'EmployeeOffboarded.v1', eventType: 'identity.employee-offboarded', eventVersion: 1 },
  employeeArchived: { name: 'EmployeeArchived.v1', eventType: 'identity.employee-archived', eventVersion: 1 },
} as const;
