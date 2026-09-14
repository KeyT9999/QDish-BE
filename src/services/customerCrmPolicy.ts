export interface CustomerCrmPlan {
  customerCrmEnabled?: boolean;
}

export function canAccessCustomerCrm(plan: CustomerCrmPlan | null | undefined): boolean {
  return plan?.customerCrmEnabled === true;
}
