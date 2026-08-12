process.env.APP_MODE = "demo";
process.env.LLM_PROVIDER = "mock";
process.env.DEMO_USER_ID = "demo-user-001";
process.env.PGLITE_DATA_DIR = "memory://";
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.VERCEL;
