import { useEffect } from "react";
import { useUserCompanies } from "@/hooks/use-companies";
import { useCompanyStore } from "@/stores/company-store";
import { useAuthStore } from "@/stores/auth-store";

export function CompanyInitializer() {
  const userId = useAuthStore((s) => s.user?.id);
  const { data: companies, isLoading } = useUserCompanies(userId);
  const setCompanies = useCompanyStore((s) => s.setCompanies);
  const setLoading = useCompanyStore((s) => s.setLoading);

  useEffect(() => {
    if (isLoading) {
      setLoading(true);
      return;
    }
    setCompanies(companies ?? []);
  }, [companies, isLoading, setCompanies, setLoading]);

  return null;
}
