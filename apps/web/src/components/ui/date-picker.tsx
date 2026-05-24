"use client"

import * as React from "react"
import { format } from "date-fns"
import { ru } from "date-fns/locale"
import { CalendarIcon, XIcon } from "lucide-react"

import { cn } from "@platform/ui/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

/**
 * Единый дата-пикер на shadcn (Popover + Calendar). Контракт значения — строка
 * "YYYY-MM-DD" (как у parseLocalDate/dateKey в schedule/utils.ts), чтобы не
 * сломать существующую логику расписания и часовые пояса.
 */
export type DatePickerProps = {
  /** Текущее значение "YYYY-MM-DD" либо null/"" (нет даты). */
  value: string | null
  /** Вызывается с новой датой "YYYY-MM-DD" либо null (очистка). */
  onChange: (next: string | null) => void
  id?: string
  disabled?: boolean
  placeholder?: string
  /** Можно ли очистить выбранную дату (кнопка-крестик). По умолчанию true. */
  clearable?: boolean
  /** Класс кнопки-триггера (например, "h-8" для компактных форм). */
  className?: string
  /** aria-label для кнопки-триггера. */
  "aria-label"?: string
}

/** Парсит "YYYY-MM-DD" в локальную дату без UTC-сдвига (полночь по локали). */
function parseValue(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const [year, month, day] = value.slice(0, 10).split("-").map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day, 0, 0, 0, 0)
}

/** Форматирует локальную дату обратно в "YYYY-MM-DD" (без UTC-сдвига). */
function formatValue(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function DatePicker({
  value,
  onChange,
  id,
  disabled,
  placeholder = "Выберите дату",
  clearable = true,
  className,
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const selected = parseValue(value)

  const handleSelect = (date: Date | undefined) => {
    onChange(date ? formatValue(date) : null)
    setOpen(false)
  }

  const handleClear = (event: React.MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    onChange(null)
  }

  const label = selected ? format(selected, "dd.MM.yyyy", { locale: ru }) : placeholder
  const showClear = clearable && Boolean(selected) && !disabled

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel ?? (selected ? `Дата: ${label}` : placeholder)}
          className={cn(
            "w-full justify-start gap-2 px-3 font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="size-4 shrink-0 opacity-70" />
          <span className="truncate">{label}</span>
          {showClear && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Очистить дату"
              onClick={handleClear}
              className="ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-0"
        // Не даём поповеру вылезти за края экрана на мобилке.
        collisionPadding={12}
      >
        <Calendar
          mode="single"
          selected={selected}
          onSelect={handleSelect}
          defaultMonth={selected}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}
