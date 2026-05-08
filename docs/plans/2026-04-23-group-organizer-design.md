# Group Organizer — Design Document

**Date:** 2026-04-23
**Project:** Annie's Candy — Internal Payroll Management App
**Tech stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui, Supabase JS v2, @dnd-kit

---

## Overview

A Group Organizer page that lets managers visually assign active factory workers to production groups. Workers are represented as draggable list items; dragging a worker to a different group card immediately upserts `employees.job` in Supabase.

---

## Project Scaffold

- Next.js 15 App Router with TypeScript
- Tailwind CSS v4
- shadcn/ui (Button, Badge, Card, Dialog, Drawer)
- `@dnd-kit/core` + `@dnd-kit/sortable`
- Supabase JS v2 (browser client for mutations, server client for SSR fetch)
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**Route structure:**
- `/` → redirect to `/group-organizer`
- `/group-organizer` — Group Organizer page

---

## Data Layer

**Factory workers** are employees where `is_active = true` AND `job` matches one of: `KING #*`, `JR #*`, `SP #*`, `COMBO #*`, `COINS #*`, `XL #*`, OR `job = 'FACTORY'` (unassigned sentinel).

**Unassigned sentinel:** `job = 'FACTORY'` marks a factory worker not yet assigned to any group. Since `job` is `NOT NULL`, this is the convention for unassigned state.

**Group deletion:** when a group card is deleted, all workers in that group have their `job` updated to `'FACTORY'` and appear in the unassigned drawer.

**Initial data fetch:** server component fetches all qualifying active employees on load. Shift toggle filters client-side (no refetch on toggle).

**Mutations:** optimistic update → Supabase upsert → rollback on error.

---

## Page Layout

### Header
- Title: "Group Organizer"
- Subtitle: today's date · N sections · N groups · N workers (live counts derived from state)
- Day / Night shift toggle (pill style, top right) — filters by `employees.nightshift`

### Candy Type Sections
Six sections stacked vertically: KING (coral), JR (blue), SP (green), COMBO (purple), COINS (amber), XL (teal).

Each section header shows:
- Color dot + candy type name
- Inline stat: "N groups · N workers"

Below the header: a **wrapping grid** of group cards (flex-wrap). Cards fill the row and wrap to the next line.

At the end of each section: an "Add Group" button that opens a small dialog — user enters a number (e.g., `42`), creates card `KING #42`. Empty group cards are **ephemeral UI state** and are not persisted to the DB; they disappear on refresh if no workers are assigned.

### Group Cards
- Header: job code (e.g., `KING #38`) + worker count badge (colored to match section)
- Delete button: visible only when the card is empty
- Body: vertical list of worker rows

**Worker rows:**
- Drag handle (left)
- First + last name
- Star icon (right) — shown if `is_group_leader = true`

**Leader pinning:**
- The worker with `is_group_leader = true` is always rendered at the top of the list
- If no worker in the group has `is_group_leader = true`, the first worker in the list is displayed with a star (acting leader — visual only, no DB write)

---

## Unassigned Workers Drawer

**Collapsed state:** floating pill anchored to the bottom-center of the viewport. Displays a badge with the count of unassigned workers (e.g., "7 Unassigned"). Always visible.

**Expanded state:** drawer slides up from the bottom (~40vh tall). Contains a responsive grid of worker chips. Worker chips are draggable — dropping one onto a group card assigns them (updates `employees.job` to the target group code).

---

## Authentication

Not in scope for this phase. Will be added in a future iteration using Supabase Auth.

---

## UI Quality

UI is built using the `frontend-design` skill to ensure a polished, production-grade result that avoids generic AI-generated aesthetics.
