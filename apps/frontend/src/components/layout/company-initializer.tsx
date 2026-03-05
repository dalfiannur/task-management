import { useEffect } from "react";
import { useAuth } from "react-oidc-context";
import { useUserCompanies } from "@/hooks/use-companies";
import { useCompanyStore } from "@/stores/company-store";

export function CompanyInitializer() {
  const auth = useAuth();
  const userId = auth.user?.profile?.sub;
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
