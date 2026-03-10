import { useState } from "react";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import styles from "./date-picker-field.module.css";

interface DatePickerFieldProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  minDate?: Date;
}

export function DatePickerField({
  value,
  onChange,
  placeholder = "Set date",
  minDate,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          type="button"
          className={cn(
            styles.dateTrigger,
            !value && styles.dateTriggerEmpty,
          )}
        >
          <CalendarIcon className={styles.dateIcon} />
          {value ? format(value, "MMM d, yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => {
            onChange(d);
            setOpen(false);
          }}
          fromDate={minDate}
          disabled={minDate ? (date) => date < minDate : undefined}
          initialFocus
        />
        {value && (
          <div className={styles.calendarFooter}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={styles.clearDateButton}
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              <X className={styles.clearDateIcon} />
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
