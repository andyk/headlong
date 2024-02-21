# make a backup of the current database.types.ts file if it exists
if [ -f src/database.types.ts ]; then
  mv src/database.types.ts src/database.types.ts.bak
fi
supabase gen types typescript --linked > src/database.types.ts