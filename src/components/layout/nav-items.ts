import {
  LayoutDashboard,
  Package,
  Compass,
  Lightbulb,
  FlaskConical,
  PlayCircle,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/overview", label: "概要", icon: LayoutDashboard },
  { href: "/products", label: "プロダクト", icon: Package },
  { href: "/market", label: "市場", icon: Compass },
  { href: "/opportunities", label: "機会", icon: Lightbulb },
  { href: "/experiments", label: "実験", icon: FlaskConical },
  { href: "/execution", label: "実行", icon: PlayCircle },
  { href: "/results", label: "結果", icon: BarChart3 },
];

export const NAV_FOOTER_ITEMS: NavItem[] = [
  { href: "/settings", label: "設定", icon: Settings },
];
