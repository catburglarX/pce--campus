/**
 * Review and complaint categories. These are seeded rows rather than a hardcoded list, so an admin can
 * add "Sports ground" next year without a code change.
 */

import { getDb } from "../db/connection";
import { notFound } from "../errors";

export type Category = {
  id: number;
  slug: string;
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
};

type CategoryRow = {
  id: number;
  slug: string;
  name: string;
  description: string;
  icon: string;
  sort_order: number;
};

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    sortOrder: row.sort_order,
  };
}

export function listCategories(): Category[] {
  return getDb()
    .query<CategoryRow, []>("SELECT * FROM categories ORDER BY sort_order, name")
    .all()
    .map(toCategory);
}

export function findCategoryBySlug(slug: string): Category | null {
  const row = getDb().query<CategoryRow, [string]>("SELECT * FROM categories WHERE slug = ?").get(slug);
  return row ? toCategory(row) : null;
}

export function requireCategoryId(categoryId: number): Category {
  const row = getDb().query<CategoryRow, [number]>("SELECT * FROM categories WHERE id = ?").get(categoryId);
  if (!row) throw notFound("Category");
  return toCategory(row);
}
