.PHONY: dev start test migrate db-clean setup

setup: migrate

dev:
	bun run --hot src/index.ts

start:
	bun run src/index.ts

test:
	bun test

migrate:
	bun run src/migrate.ts

db-clean:
	rm -rf data
