export type ClientStatus = "active" | "inactive";

export interface Client {
  id: string;
  name: string;
  legalName?: string;
  companyId?: string;
  companyName?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  status: ClientStatus;
}
