import { X } from "lucide-react";
import { format } from "date-fns";
import { Button, DatePicker } from "sedjiwa-ui";

interface DatePickerFieldProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  minDate?: Date;
}

const ISO = "yyyy-MM-dd";

/** Parse `YYYY-MM-DD` as a local date — `new Date(iso)` would read it as UTC
 *  midnight and land on the previous day west of Greenwich. */
function fromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** sedjiwa-ui `DatePicker` speaks ISO strings and has no way to clear a value;
 *  this adapter keeps the app's `Date | undefined` contract and adds the
 *  clear button the task and filter fields need. */
export function DatePickerField({
  value,
  onChange,
  placeholder = "Set date",
  minDate,
}: DatePickerFieldProps) {
  return (
    <span className="inline-flex items-center gap-1">
      <DatePicker
        size="sm"
        value={value ? format(value, ISO) : null}
        onValueChange={(iso) => onChange(iso ? fromIso(iso) : undefined)}
        min={minDate ? format(minDate, ISO) : undefined}
        placeholder={placeholder}
        // sedjiwa-ui defaults to id-ID; this app's copy is English.
        locale="en-US"
        formatLabel={(d) => format(d, "MMM d, yyyy")}
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Clear date"
          onClick={() => onChange(undefined)}
        >
          <X />
        </Button>
      )}
    </span>
  );
}
