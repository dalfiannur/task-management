import { useDivisions } from "@/hooks/use-divisions";
import { SearchSelect } from "./search-select";

interface DivisionComboboxProps {
  value?: string;
  onChange: (divisionId: string | undefined) => void;
  companyId?: string;
}

export function DivisionCombobox({
  value,
  onChange,
  companyId,
}: DivisionComboboxProps) {
  const { data: divisions } = useDivisions(companyId);

  return (
    <SearchSelect
      options={divisions ?? []}
      value={value}
      onChange={onChange}
      getOptionValue={(d) => d.id}
      getOptionLabel={(d) => d.name}
      variant="pill"
      placeholder={companyId ? "Select division..." : "Select company first"}
      searchPlaceholder="Search divisions..."
      emptyText="No division found."
      disabled={!companyId}
    />
  );
}
