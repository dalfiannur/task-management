import { create } from "zustand";

const STORAGE_KEY = "selectedCompanyId";

export interface UserCompany {
  id: string;
  name: string;
}

interface CompanyState {
  companies: UserCompany[];
  selectedCompanyId: string | null;
  isLoading: boolean;
  setCompanies: (companies: UserCompany[]) => void;
  selectCompany: (companyId: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useCompanyStore = create<CompanyState>((set) => ({
  companies: [],
  selectedCompanyId: localStorage.getItem(STORAGE_KEY),
  isLoading: true,
  setCompanies: (companies) =>
    set((state) => {
      const persisted = state.selectedCompanyId;
      const valid = companies.some((c) => c.id === persisted);
      const selectedCompanyId = valid ? persisted : companies[0]?.id ?? null;
      if (selectedCompanyId)
        localStorage.setItem(STORAGE_KEY, selectedCompanyId);
      return { companies, selectedCompanyId, isLoading: false };
    }),
  selectCompany: (companyId) => {
    localStorage.setItem(STORAGE_KEY, companyId);
    set({ selectedCompanyId: companyId });
  },
  setLoading: (isLoading) => set({ isLoading }),
}));
