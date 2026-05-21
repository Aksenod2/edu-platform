/**
 * Atoms — базовые неделимые элементы дизайн-системы
 *
 * Атомарный уровень: ATOM
 * Состав: Button, Input, Label, Badge, Typography (Heading/Text/Mono), Divider, Spinner, Avatar
 */

export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { Input } from './Input';
export type { InputProps, InputSize } from './Input';

export { Label } from './Label';
export type { LabelProps } from './Label';

export { Badge } from './Badge';
export type { BadgeProps, BadgeVariant } from './Badge';

export { Heading, Text, Mono } from './Typography';
export type { HeadingProps, TextProps, MonoProps } from './Typography';

export { Divider } from './Divider';
export type { DividerProps } from './Divider';

export { Spinner } from './Spinner';
export type { SpinnerProps, SpinnerSize } from './Spinner';

export { Avatar, AvatarRoot, AvatarImage, AvatarFallback } from './Avatar';
export type { AvatarProps, AvatarSize, AvatarRootProps, AvatarImageProps, AvatarFallbackProps } from './Avatar';

export { Select } from './Select';
export type { SelectProps, SelectSize } from './Select';
// Shadcn/Radix Select sub-components
export {
  SelectRoot,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
} from './Select';

export { Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';
