process.env.APP_MODE = "demo";
process.env.LLM_PROVIDER = "mock";
process.env.DEMO_USER_ID = "demo-user-001";
// Public local-test credential MtrLocalTestOnly!. Deployment requires a different secret hash.
process.env.DEMO_PASSWORD_HASH = "scrypt$16384$8$1$5Qr53Li_UbDOnhJzIumUzw$OnJc6NYv7o1rF5xkdJKUCPb_QbSc9Yeuc-GaCB_KVuABn4SxmUKk2qYt0S3tNsUtAOQPHhIIkyVKn3l-leakrg";
process.env.PGLITE_DATA_DIR = "memory://";
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.VERCEL;
