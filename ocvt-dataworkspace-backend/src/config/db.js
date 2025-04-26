const { Sequelize } = require("sequelize");
require("dotenv").config();

// Configuration de Sequelize avec réplication (lecture/écriture)
const sequelize = new Sequelize({
  dialect: "postgres",
  define: {
    underscored: true,
    timestamps: true,
  },
  replication: {
    read: [
      {
        host: process.env.DB_READ_HOST,
        username: process.env.DB_READ_USERNAME,
        password: process.env.DB_READ_PASSWORD,
        database: process.env.DB_READ_DATABASE,
        port: process.env.DB_READ_PORT,
      },
    ],
    write: {
      host: process.env.DB_WRITE_HOST,
      username: process.env.DB_WRITE_USERNAME,
      password: process.env.DB_WRITE_PASSWORD,
      database: process.env.DB_WRITE_DATABASE,
      port: process.env.DB_WRITE_PORT,
    },
  },
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  logging: false,
});

module.exports = sequelize;
