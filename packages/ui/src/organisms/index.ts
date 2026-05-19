/**
 * Organisms — сложные компоненты, составленные из молекул и атомов
 *
 * Атомарный уровень: ORGANISM
 * Состав: Header, Sidebar, StudentCard, AssignmentList
 */

export { Header } from './Header';
export type { HeaderProps, HeaderUser } from './Header';

export { Sidebar } from './Sidebar';
export type { SidebarProps, SidebarSection } from './Sidebar';

export { StudentCard } from './StudentCard';
export type { StudentCardProps, StudentCardStudent, StudentStatus } from './StudentCard';

export { AssignmentList } from './AssignmentList';
export type { AssignmentListProps, Assignment, AssignmentStatus } from './AssignmentList';
