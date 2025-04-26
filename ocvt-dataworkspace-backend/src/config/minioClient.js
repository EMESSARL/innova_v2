const Minio = require("minio");
require('dotenv').config();

// Configuration du client MinIO
const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || "localhost",
  port: parseInt(process.env.MINIO_PORT) || 9000,
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY || "admin",
  secretKey: process.env.MINIO_SECRET_KEY || "password123",
  region: process.env.MINIO_REGION || "us-east-1",
  pathStyle: process.env.MINIO_USE_PATH_STYLE === 'true'
});

module.exports = minioClient;
