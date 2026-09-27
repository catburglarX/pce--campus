/**
 * Base data the site cannot run without: review categories, a weekly mess menu, and one admin account.
 *
 * Safe to run more than once. Categories and menu rows are upserted by their natural key, and the admin
 * is only created when no admin exists.
 */

import { randomBytes } from "node:crypto";

import { getDb, useDatabase } from "./connection";
import { config } from "../config";
import { isoTimestamp } from "../domain/calendar";
import { MEALS, type Meal } from "../domain/rating";
import { hashPassword } from "../services/users";

type CategorySeed = { slug: string; name: string; description: string; icon: string };

const CATEGORIES: CategorySeed[] = [
  { slug: "mess-food", name: "Mess food", description: "Daily mess meals, taste, hygiene and quantity", icon: "MF" },
  { slug: "canteen", name: "Canteen and cafeteria", description: "Snacks, prices and service", icon: "CN" },
  { slug: "hostel", name: "Hostel and rooms", description: "Rooms, water, power, warden support", icon: "HS" },
  { slug: "classrooms", name: "Classrooms and labs", description: "Projectors, benches, lab equipment", icon: "CL" },
  { slug: "faculty", name: "Teaching and faculty", description: "Teaching quality, doubt clearing, notes", icon: "FC" },
  { slug: "library", name: "Library", description: "Books, journals, reading room, silence", icon: "LB" },
  { slug: "wifi", name: "WiFi and IT", description: "Campus WiFi, computer labs, portal uptime", icon: "IT" },
  { slug: "transport", name: "College bus and transport", description: "Routes, timing, driver conduct", icon: "TR" },
  { slug: "sports", name: "Sports and gym", description: "Ground, equipment, gym access", icon: "SP" },
  { slug: "events", name: "Fests and events", description: "Cultural, technical and club events", icon: "EV" },
  { slug: "washrooms", name: "Washrooms and cleanliness", description: "Housekeeping and water supply", icon: "WC" },
  { slug: "medical", name: "Medical and first aid", description: "Campus clinic and emergency response", icon: "MD" },
  { slug: "placement", name: "Placement cell", description: "Drives, training, communication", icon: "PL" },
  { slug: "admin-office", name: "Admin office and fees", description: "Fees, documents, scholarship help", icon: "AO" },
];

/** Weekday 0 is Sunday, matching mess_menu.weekday and Date.getUTCDay(). */
const WEEKLY_MENU: Record<number, Record<Meal, string>> = {
  0: {
    breakfast: "Aloo paratha, curd, pickle, tea",
    lunch: "Rajma chawal, roti, salad, papad",
    snacks: "Samosa, green chutney, tea",
    dinner: "Shahi paneer, jeera rice, roti, gulab jamun",
  },
  1: {
    breakfast: "Poha, sev, banana, milk",
    lunch: "Kadhi pakora, rice, roti, cucumber salad",
    snacks: "Bread pakora, sauce, tea",
    dinner: "Mix veg, dal fry, roti, rice",
  },
  2: {
    breakfast: "Idli, sambhar, coconut chutney, coffee",
    lunch: "Chole, bhature, onion salad, chaas",
    snacks: "Vada pav, fried chilli, tea",
    dinner: "Aloo gobhi, dal tadka, roti, rice",
  },
  3: {
    breakfast: "Upma, tomato chutney, tea",
    lunch: "Dal makhani, rice, roti, boondi raita",
    snacks: "Maggi, ketchup, coffee",
    dinner: "Matar paneer, roti, rice, sooji halwa",
  },
  4: {
    breakfast: "Stuffed paratha, butter, curd, tea",
    lunch: "Sambhar rice, poriyal, roti, curd",
    snacks: "Aloo tikki chaat, tea",
    dinner: "Bhindi masala, arhar dal, roti, rice",
  },
  5: {
    breakfast: "Bread omelette or bread jam, milk",
    lunch: "Veg pulao, dal, raita, papad",
    snacks: "Pav bhaji, tea",
    dinner: "Kadhai paneer, roti, rice, kheer",
  },
  6: {
    breakfast: "Chole bhature, tea",
    lunch: "Veg biryani, mirchi raita, salad",
    snacks: "Cutlet, sauce, coffee",
    dinner: "Dal palak, aloo matar, roti, rice",
  },
};

export function seedCategories(): number {
  const db = getDb();
  const insert = db.query(
    `INSERT INTO categories (slug, name, description, icon, sort_order) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (slug) DO UPDATE SET name = excluded.name, description = excluded.description,
       icon = excluded.icon, sort_order = excluded.sort_order`,
  );
  CATEGORIES.forEach((category, index) => {
    insert.run(category.slug, category.name, category.description, category.icon, index);
  });
  return CATEGORIES.length;
}

export function seedWeeklyMenu(): number {
  const db = getDb();
  const insert = db.query(
    `INSERT INTO mess_menu (weekday, meal, items, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (weekday, meal) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at`,
  );
  const now = isoTimestamp();
  let written = 0;
  for (const [weekday, meals] of Object.entries(WEEKLY_MENU)) {
    for (const meal of MEALS) {
      insert.run(Number(weekday), meal, meals[meal], now);
      written += 1;
    }
  }
  return written;
}

export type AdminSeedResult = { email: string; generatedPassword: string | null };

/**
 * Creates the first admin if none exists. The password comes from ADMIN_PASSWORD when set, otherwise a
 * random one is generated and returned so the caller can print it once. No default password ships.
 */
export async function ensureAdminAccount(): Promise<AdminSeedResult> {
  const db = getDb();
  const email = (process.env.ADMIN_EMAIL ?? "admin@poornima.org").toLowerCase();
  const existing = db
    .query<{ id: number }, []>("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
    .get();
  if (existing) return { email, generatedPassword: null };

  const suppliedPassword = process.env.ADMIN_PASSWORD;
  const password = suppliedPassword ?? `pce-${randomBytes(9).toString("base64url")}`;
  const now = isoTimestamp();
  db.run(
    `INSERT INTO users (email, name, password_hash, role, branch, study_year, is_hostel_resident, created_at, password_changed_at)
     VALUES (?, ?, ?, 'admin', ?, NULL, 0, ?, ?)
     ON CONFLICT (email) DO UPDATE SET role = 'admin'`,
    [email, "Campus Admin", await hashPassword(password), "Administration", now, now],
  );
  return { email, generatedPassword: suppliedPassword ? null : password };
}

export async function seedBaseData(): Promise<void> {
  seedCategories();
  seedWeeklyMenu();
  await ensureAdminAccount();
}

async function main(): Promise<void> {
  useDatabase(config.databasePath);
  const categories = seedCategories();
  const menuRows = seedWeeklyMenu();
  const admin = await ensureAdminAccount();
  console.log(`Seeded ${categories} categories and ${menuRows} menu rows into ${config.databasePath}`);
  console.log(`Admin email: ${admin.email}`);
  if (admin.generatedPassword) {
    console.log(`Admin password (shown once, save it now): ${admin.generatedPassword}`);
  } else {
    console.log("Admin already existed or ADMIN_PASSWORD was supplied, so no password was generated.");
  }
  console.log(`Join code students must enter to register: ${config.joinCode}`);
}

if (import.meta.main) {
  await main();
}
