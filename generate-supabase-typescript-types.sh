# make a backup of the current database.types.ts file if it exists
if [ -f packages/webapp/src/database.types.ts ]; then
  mv packages/webapp/src/database.types.ts packages/webapp/src/database.types.ts.bak
fi
if [ -f packages/env/database.types.ts ]; then
  mv packages/env/database.types.ts packages/env/database.types.ts.bak
fi
supabase gen types typescript --linked > packages/webapp/src/database.types.ts
supabase gen types typescript --linked > packages/env/database.types.ts
