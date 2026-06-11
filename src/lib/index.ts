// src/lib/index.ts
// Barrel file — available for components that want to import
// from a specific file rather than supabase.ts directly.
// Most components use supabase.ts which re-exports everything.

export * from "./supabase";
