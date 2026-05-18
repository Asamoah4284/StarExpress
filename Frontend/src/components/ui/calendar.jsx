"use client"

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"

import "react-day-picker/style.css"

/**
 * @param {import("react-day-picker").DayPickerProps} props
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = false,
  captionLayout = "label",
  navLayout = "around",
  ...props
}) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      navLayout={navLayout}
      className={cn("date-range-calendar", className)}
      classNames={{
        months: "relative flex flex-col gap-6 sm:flex-row sm:gap-8",
        month: "min-w-[252px] space-y-2",
        month_caption: "relative flex h-10 items-center justify-center px-10",
        caption_label: "text-sm font-semibold text-foreground",
        dropdowns: "flex items-center justify-center gap-2",
        dropdown_root: "border-input bg-background relative inline-flex items-center rounded-md border shadow-none",
        dropdown: "absolute inset-0 z-20 cursor-pointer opacity-0",
        months_dropdown: "h-9 min-w-[5.5rem] appearance-none bg-transparent py-1 pr-7 pl-2.5 text-sm font-medium capitalize",
        years_dropdown: "h-9 min-w-[4.5rem] appearance-none bg-transparent py-1 pr-7 pl-2.5 text-sm font-medium",
        button_previous: cn("rdp-nav-btn", "absolute top-0 left-0 z-30"),
        button_next: cn("rdp-nav-btn", "absolute top-0 right-0 z-30"),
        weekdays: "flex",
        weekday:
          "text-muted-foreground flex-1 text-center text-[0.7rem] font-medium uppercase tracking-wide",
        weeks: "space-y-1",
        week: "mt-0 flex w-full",
        day: "p-0 text-center",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClass, ...chevronProps }) => {
          if (orientation === "down") {
            return <ChevronDown className={cn("size-3.5 opacity-60", chevronClass)} aria-hidden {...chevronProps} />
          }
          if (orientation === "left") {
            return <ChevronLeft className={cn("size-4", chevronClass)} aria-hidden {...chevronProps} />
          }
          return <ChevronRight className={cn("size-4", chevronClass)} aria-hidden {...chevronProps} />
        },
      }}
      {...props}
    />
  )
}

export { Calendar }
