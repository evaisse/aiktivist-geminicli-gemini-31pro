import { runMigrations } from "./db.ts";

console.log("Running migrations...");
runMigrations();
console.log("Migrations applied successfully.");
