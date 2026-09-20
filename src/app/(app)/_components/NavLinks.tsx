"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DashboardIcon,
  CalendarIcon,
  LocationIcon,
  SkillIcon,
  StaffIcon,
} from "@/components/icons";

const navLinkClass =
  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const activeNavLinkClass = "bg-accent-subtle text-accent hover:bg-accent-subtle hover:text-accent";

const baseLinks = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/schedule", label: "Schedule", icon: CalendarIcon },
] as const;

const adminLinks = [
  { href: "/admin/locations", label: "Locations", icon: LocationIcon },
  { href: "/admin/skills", label: "Skills", icon: SkillIcon },
  { href: "/admin/staff", label: "Staff", icon: StaffIcon },
] as const;

export function NavLinks({ isAdmin }: { readonly isAdmin: boolean }) {
  const pathname = usePathname();
  const links = isAdmin ? [...baseLinks, ...adminLinks] : baseLinks;

  return (
    <>
      {links.map(({ href, label, icon: Icon }) => {
        // /schedule must also match /schedule/[shiftId], but /dashboard must
        // not match anything else -- a plain startsWith on every link would
        // make "/" match everything.
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`${navLinkClass} ${active ? activeNavLinkClass : ""}`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </>
  );
}
