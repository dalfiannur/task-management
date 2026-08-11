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
            "inline-flex items-center gap-[0.3125rem] rounded-md px-1.5 h-6 font-mono text-sm leading-4 border-0 bg-transparent hover:bg-surface-sunken/50 transition-colors",
            !value && "text-text-muted",
          )}
        >
          <CalendarIcon className="size-3" />
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
          <div className="p-1.5 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-text-muted text-sm leading-4 h-6"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              <X className="mr-[0.1875rem] size-3" />
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
