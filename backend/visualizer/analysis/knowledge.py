"""What the analysis agent knows: which packages mean which framework, database or outside service."""

from __future__ import annotations

IGNORE_DIRS = {
    "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", "coverage", ".turbo", ".cache", "__pycache__",
    "venv", ".venv", "env", "target", "vendor", ".idea", ".vscode", "release", ".svelte-kit", ".gradle", "bin", "obj",
    "storage", "uploads", ".playwright-mcp", "site-packages",
}
EXTENSIONS = {
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "kt", "rb", "php", "cs", "vue", "svelte", "sql",
    "prisma", "graphql",
}
LANGUAGES = {
    "ts": "TypeScript", "tsx": "TypeScript", "js": "JavaScript", "jsx": "JavaScript", "mjs": "JavaScript", "cjs": "JavaScript",
    "py": "Python", "go": "Go", "rs": "Rust", "java": "Java", "kt": "Kotlin", "rb": "Ruby", "php": "PHP", "cs": "C#",
    "vue": "Vue", "svelte": "Svelte", "sql": "SQL", "prisma": "Prisma", "graphql": "GraphQL",
}

# package name -> (where it shows, label). Where: frontend, backend, database, service.
DEPS = {
    # frontend
    "react": ("frontend", "React"), "next": ("frontend", "Next.js"), "vue": ("frontend", "Vue"), "nuxt": ("frontend", "Nuxt"),
    "svelte": ("frontend", "Svelte"), "@angular/core": ("frontend", "Angular"), "vite": ("frontend", "Vite"),
    "tailwindcss": ("frontend", "Tailwind CSS"), "@tanstack/react-query": ("frontend", "React Query"),
    "react-router-dom": ("frontend", "React Router"), "@mui/material": ("frontend", "MUI"), "redux": ("frontend", "Redux"),
    "@reduxjs/toolkit": ("frontend", "Redux"), "zustand": ("frontend", "Zustand"), "three": ("frontend", "three.js"),
    # backend
    "express": ("backend", "Express"), "fastify": ("backend", "Fastify"), "koa": ("backend", "Koa"), "hono": ("backend", "Hono"),
    "@nestjs/core": ("backend", "NestJS"), "fastapi": ("backend", "FastAPI"), "django": ("backend", "Django"),
    "flask": ("backend", "Flask"), "djangorestframework": ("backend", "Django REST"), "celery": ("backend", "Celery"),
    "apscheduler": ("backend", "APScheduler"), "langchain": ("backend", "LangChain"), "github.com/gin-gonic/gin": ("backend", "Gin"),
    "rails": ("backend", "Rails"), "laravel/framework": ("backend", "Laravel"), "uvicorn": ("backend", "Uvicorn"),
    # database
    "sqlalchemy": ("database", "SQLAlchemy"), "alembic": ("database", "Alembic"), "prisma": ("database", "Prisma"),
    "@prisma/client": ("database", "Prisma"), "typeorm": ("database", "TypeORM"), "sequelize": ("database", "Sequelize"),
    "mongoose": ("database", "MongoDB"), "pymongo": ("database", "MongoDB"), "psycopg": ("database", "PostgreSQL"),
    "psycopg2": ("database", "PostgreSQL"), "psycopg2-binary": ("database", "PostgreSQL"), "asyncpg": ("database", "PostgreSQL"),
    "pg": ("database", "PostgreSQL"), "pgvector": ("database", "pgvector"), "mysql2": ("database", "MySQL"),
    "mysqlclient": ("database", "MySQL"), "pymysql": ("database", "MySQL"), "better-sqlite3": ("database", "SQLite"),
    "redis": ("database", "Redis"), "ioredis": ("database", "Redis"), "elasticsearch": ("database", "Elasticsearch"),
    # outside services
    "stripe": ("service", "Stripe"), "openai": ("service", "OpenAI"), "langchain-openai": ("service", "OpenAI"),
    "anthropic": ("service", "Anthropic Claude"), "langchain-anthropic": ("service", "Anthropic Claude"),
    "@anthropic-ai/sdk": ("service", "Anthropic Claude"), "boto3": ("service", "AWS"), "langchain-aws": ("service", "AWS Bedrock"),
    "twilio": ("service", "Twilio"), "sendgrid": ("service", "SendGrid"), "@sendgrid/mail": ("service", "SendGrid"),
    "firebase": ("service", "Firebase"), "firebase-admin": ("service", "Firebase"), "@supabase/supabase-js": ("service", "Supabase"),
    "supabase": ("service", "Supabase"), "auth0": ("service", "Auth0"), "sentry-sdk": ("service", "Sentry"),
    "razorpay": ("service", "Razorpay"), "paypalrestsdk": ("service", "PayPal"), "slack-sdk": ("service", "Slack"),
    "@slack/web-api": ("service", "Slack"), "googleapis": ("service", "Google APIs"), "cloudinary": ("service", "Cloudinary"),
    "algoliasearch": ("service", "Algolia"), "pinecone-client": ("service", "Pinecone"), "cohere": ("service", "Cohere"),
}
DEP_PREFIXES = {"@aws-sdk/": ("service", "AWS"), "@sentry/": ("service", "Sentry"), "google-cloud-": ("service", "Google Cloud"), "@google-cloud/": ("service", "Google Cloud")}

# Names in .env files that point to an outside service.
ENV_PREFIXES = {
    "STRIPE_": "Stripe", "OPENAI_": "OpenAI", "ANTHROPIC_": "Anthropic Claude", "AWS_": "AWS", "TWILIO_": "Twilio",
    "SENDGRID_": "SendGrid", "SMTP_": "Email (SMTP)", "FIREBASE_": "Firebase", "SUPABASE_": "Supabase", "SENTRY_": "Sentry",
    "RAZORPAY_": "Razorpay", "SLACK_": "Slack", "GOOGLE_": "Google APIs", "CLOUDINARY_": "Cloudinary",
}
DB_SCHEMES = {"postgresql": "PostgreSQL", "postgres": "PostgreSQL", "mysql": "MySQL", "sqlite": "SQLite", "mongodb": "MongoDB", "redis": "Redis"}
DOCKER_IMAGES = {"postgres": "PostgreSQL", "pgvector": "pgvector", "mysql": "MySQL", "mariadb": "MariaDB", "mongo": "MongoDB", "redis": "Redis", "elasticsearch": "Elasticsearch", "rabbitmq": "RabbitMQ"}

# Words that name a feature. The first word found in a path decides the feature's name.
FEATURE_WORDS = {
    "Login & Auth": ["auth", "login", "logout", "signup", "signin", "register", "session", "password", "jwt", "oauth", "rbac"],
    "Payment": ["payment", "pay", "checkout", "stripe", "billing", "invoice", "subscription", "paypal"],
    "Cart": ["cart", "basket", "bag"],
    "Products": ["product", "catalog", "shop", "store", "inventory", "listing"],
    "Orders": ["order", "shipping", "delivery"],
    "Admin": ["admin", "backoffice"],
    "Users": ["user", "profile", "account", "member", "people"],
    "Search": ["search", "filter"],
    "Notifications": ["notification", "email", "mail", "sms"],
    "Blog": ["post", "blog", "article", "comment"],
    "Dashboard": ["dashboard"],
}
WORD_TO_FEATURE = {w: f for f, words in FEATURE_WORDS.items() for w in words}

# Words that say where a file lives, not what it is about. They never name a feature.
STOP = {
    "src", "app", "apps", "lib", "libs", "components", "component", "pages", "page", "routes", "route", "router", "api", "apis",
    "backend", "frontend", "server", "client", "web", "services", "service", "controllers", "controller", "models", "model",
    "utils", "util", "helpers", "helper", "hooks", "hook", "types", "type", "styles", "style", "public", "assets", "asset",
    "tests", "test", "spec", "specs", "e2e", "middleware", "config", "configs", "common", "shared", "core", "index", "main",
    "packages", "internal", "cmd", "pkg", "features", "feature", "schemas", "schema", "deps", "base", "init", "ui", "brand",
    "layout", "layouts", "view", "views", "context", "store", "stores", "state", "constants", "const",
    "form", "forms", "list", "lists", "table", "tables", "card", "cards", "panel", "panels", "modal",
    "dialog", "dialogs", "tab", "tabs", "button", "input", "dto", "dtos", "handler", "handlers", "repo", "repository", "mock",
    "mocks", "fixture", "fixtures", "conftest", "setup", "script", "scripts", "tools", "tool", "runtime",
    "registry", "catalog", "data", "sync", "match", "compare", "ts", "js", "tsx", "jsx", "py", "get", "set", "new", "use", "the",
}
