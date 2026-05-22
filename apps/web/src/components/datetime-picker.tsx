"use client"

import * as React from "react"
import { format } from "date-fns"
import { ru } from "date-fns/locale"
import { CalendarIcon, X } from "lucide-react"

import { cn } from "@platform/ui/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

// Контролируемый пикер даты-времени на shadcn (Calendar в Popover + поле времени).
// Значение наружу — наивная локальная строка "YYYY-MM-DDTHH:MM" или "" (пусто).
// Внутри работает только с локальными компонентами (год-месяц-день + HH:MM),
// без toISOString / без сдвига часового пояса.

type DateTimePickerProps = {
  /** Наивная локальная строка "YYYY-MM-DDTHH:MM" или "". */
  value: string
  /** Возвращает строку в том же формате "YYYY-MM-DDTHH:MM" либо "". */
  onChange: (value: string) => void
  id?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}

// Разбирает "YYYY-MM-DDTHH:MM" на локальные части. Дату собираем через
// конструктор Date(год, месяц, день) — это локальное время без сдвига UTC.
function parseValue(value: string): { date?: Date; time: string } {
  if (!value) return { date: undefined, time: "" }
  const [datePart, timePart = ""] = value.split("T")
  const [y, m, d] = datePart.split("-").map(Number)
  if (!y || !m || !d) return { date: undefined, time: timePart }
  return { date: new Date(y, m - 1, d), time: timePart }
}

// Двузначное число с ведущим нулём.
function pad(n: number): string {
  return String(n).padStart(2, "0")
}

// Собирает наивную строку "YYYY-MM-DDTHH:MM" из локальной даты и времени.
function buildValue(date: Date | undefined, time: string): string {
  if (!date) return ""
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  // Если время не задано — подставляем 00:00, чтобы значение оставалось валидным.
  const timePart = time || "00:00"
  return `${datePart}T${timePart}`
}

export function DateTimePicker({
  value,
  onChange,
  id,
  placeholder = "Выберите дату и время",
  disabled,
  className,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)
  const { date, time } = parseValue(value)

  const handleSelectDay = (day: Date | undefined) => {
    if (!day) {
      onChange("")
      return
    }
    onChange(buildValue(day, time))
  }

  const handleTimeChange = (newTime: string) => {
    // Время без выбранной даты не имеет смысла — игнорируем, пока нет дня.
    if (!date) return
    onChange(buildValue(date, newTime))
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange("")
  }

  // Человекочитаемая подпись на кнопке (ru-формат) или плейсхолдер.
  const label = date
    ? `${format(date, "d MMMM yyyy", { locale: ru })}${time ? `, ${time}` : ""}`
    : placeholder

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          data-empty={!date}
          className={cn(
            "w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="size-4 shrink-0" />
          <span className="flex-1 truncate">{label}</span>
          {date && !disabled ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Очистить"
              onClick={handleClear}
              className="ml-auto inline-flex shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={handleSelectDay}
          autoFocus
        />
        <div className="flex items-center gap-2 border-t p-3">
          <label
            htmlFor={id ? `${id}-time` : undefined}
            className="text-sm text-muted-foreground"
          >
            Время
          </label>
          <input
            id={id ? `${id}-time` : undefined}
            type="time"
            value={time}
            disabled={!date}
            onChange={(e) => handleTimeChange(e.target.value)}
            className={cn(
              "h-9 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
              "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              // Иконка часов нативного поля окрашивается в текущий цвет текста,
              // чтобы корректно выглядеть в тёмной теме.
              "[&::-webkit-calendar-picker-indicator]:opacity-60 dark:[&::-webkit-calendar-picker-indicator]:invert"
            )}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
