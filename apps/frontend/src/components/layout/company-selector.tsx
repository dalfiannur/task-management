import { useCompanyStore } from "@/stores/company-store";
import { resetAllStores } from "@/lib/graphql-client";
import { Building2 } from "lucide-react";
import { SearchSelect } from "@/components/shared/search-select";

export function CompanySelector() {
  const { companies, selectedCompanyId, selectCompany, isLoading } =
    useCompanyStore();

  if (isLoading || companies.length === 0) return null;

  function handleChange(value: string | undefined) {
    if (value) {
      selectCompany(value);
      resetAllStores();
    }
  }

  // Single company — just show the name, no dropdown
  if (companies.length === 1) {
    return (
      <div className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground px-1">
        <Building2 className="size-[0.8125rem] shrink-0 text-muted-foreground" />
        <span className="truncate max-w-[12rem]">{companies[0].name}</span>
      </div>
    );
  }

  return (
    <SearchSelect
      options={companies}
      value={selectedCompanyId ?? undefined}
      onChange={handleChange}
      getOptionValue={(c) => c.id}
      getOptionLabel={(c) => c.name}
      filterLocally
      clearable={false}
      variant="pill"
      placeholder="Select company"
      renderSelected={(c) => (
        <span className="flex items-center gap-1.5">
          <Building2 className="size-[0.8125rem] shrink-0 text-muted-foreground" />
          {c.name}
        </span>
      )}
      renderOption={(c) => (
        <span className="flex items-center gap-1.5">
          <Building2 className="size-[0.8125rem] shrink-0 text-muted-foreground" />
          {c.name}
        </span>
      )}
      className="min-w-[8rem] max-w-[14rem]"
    />
  );
}
