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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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

// Списки для селектов времени.
const HOURS = Array.from({ length: 24 }, (_, i) => pad(i))
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i))

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
  const [hh = "", mm = ""] = time ? time.split(":") : []

  const handleSelectDay = (day: Date | undefined) => {
    if (!day) {
      onChange("")
      return
    }
    onChange(buildValue(day, time))
  }

  // Смена часов/минут. Время без выбранной даты не имеет смысла — игнорируем.
  const handleHour = (h: string) => {
    if (!date) return
    onChange(buildValue(date, `${h}:${mm || "00"}`))
  }
  const handleMinute = (m: string) => {
    if (!date) return
    onChange(buildValue(date, `${hh || "00"}:${m}`))
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
          <span className="text-sm text-muted-foreground">Время</span>
          <Select value={hh} onValueChange={handleHour} disabled={!date}>
            <SelectTrigger className="flex-1" aria-label="Часы">
              <SelectValue placeholder="чч" />
            </SelectTrigger>
            <SelectContent className="max-h-56">
              {HOURS.map((h) => (
                <SelectItem key={h} value={h}>
                  {h}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">:</span>
          <Select value={mm} onValueChange={handleMinute} disabled={!date}>
            <SelectTrigger className="flex-1" aria-label="Минуты">
              <SelectValue placeholder="мм" />
            </SelectTrigger>
            <SelectContent className="max-h-56">
              {MINUTES.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  )
}
