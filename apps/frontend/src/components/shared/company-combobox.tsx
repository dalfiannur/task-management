import { useState, useEffect } from "react";
import { useCompanies } from "@/hooks/use-companies";
import { SearchSelect } from "./search-select";

interface CompanyComboboxProps {
  value?: string;
  onChange: (companyId: string | undefined) => void;
}

interface CompanyOption {
  id: string;
  name: string;
  legalName?: string;
}

export function CompanyCombobox({ value, onChange }: CompanyComboboxProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: companies } = useCompanies(debouncedSearch || undefined);

  return (
    <SearchSelect<CompanyOption>
      options={companies ?? []}
      value={value}
      onChange={onChange}
      getOptionValue={(c) => c.id}
      getOptionLabel={(c) => c.name}
      searchValue={search}
      onSearchChange={setSearch}
      filterLocally={false}
      variant="pill"
      placeholder="Select company..."
      searchPlaceholder="Search companies..."
      emptyText="No company found."
      renderOption={(company) => (
        <div className="flex flex-col gap-px">
          <span className="font-medium">{company.name}</span>
          {company.legalName && company.legalName !== company.name && (
            <span className="text-sm text-muted-foreground">
              {company.legalName}
            </span>
          )}
        </div>
      )}
    />
  );
}
